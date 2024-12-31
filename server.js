/*
require("dotenv").config();
const session = require("express-session");
*/

//Set up pool for database connection
const { createPool } = require("mariadb");
const pool = createPool({
  host: "localhost",
  user: "service",
  database: "boc",
  password: "test123",
  connectionLimit: 5,
});


//Logger
const path = require('path');
const fs = require("fs").promises;
const moment = require("moment");
const LOG_FILE = path.join(__dirname, 'log.txt');
const logger = {
  log_file: LOG_FILE,
  async log(msg) {
    let date = new Date();
    let curr_dt = moment(date).format("MM-DD HH:mm:ss (YYYY)");
    let log_str = `${curr_dt} - ${msg}\n`;
    fs.appendFile(this.log_file, log_str);
  },
  async start() {
    try { await fs.rm(LOG_FILE); } //Refreshes log on startup
    catch (err) { if (err.code === "ENOENT") { console.log("THIS HAPPENED"); } else { throw err } }
    this.log("Logger started");
  }
}

//Handle global errors without shutting the whole program down
process.on("unhandledRejection", (reason, promise) => {
  let trace = '';
  if (reason instanceof Error) { trace = reason.stack } 
  err_msg = `FAILED PROMISE: ${promise} occurred because ${reason}\n${trace}`;
  console.error(err_msg);
  logger.log(err_msg);
});
process.on("uncaughtException", (reason, exception_origin) => {
  let trace = '';
  if (reason instanceof Error) { trace = reason.stack } 
  err_msg = `EXCEPTION THROWN: ${exception_origin} occurred because ${reason}\n${trace}`;
  console.error(err_msg);
  logger.log(err_msg);
})

//
//QUERY HELPERS
//
//const exec_query = (query_string) => {} 

async function getTrips() {
  let conn = await pool.getConnection();
  let trips = await conn.query("SELECT * FROM trips");
  conn.release();
  return trips;
}

async function getUserInfo(email) {
  let conn;
  try {
    let conn = await pool.getConnection();
    const user_data = conn.query(`SELECT * FROM users WHERE email = '${email}'`);
    const user_trips = conn.query(
      `SELECT trip_name FROM (
        trips JOIN (
          SELECT trip_id FROM user_trip_map
          WHERE user_id = (
            SELECT user_id FROM users
            WHERE email = '${email}'
          )
        ) AS trip_ids ON trips.id = trip_ids.trip_id
      )`
    )
    return {
      user_data: await user_data,
      user_trips: await user_trips
    };
  } catch (err) {
    throw err;
  } finally {
    if (conn) conn.release();
  }
}

//
//MIDDLEWARE
//

//Logs method and origin of incoming requests
async function logRequest(req, _res, next) {
  logger.log(`${req.method} request received from ${req.connection.remoteAddress}:${req.connection.remotePort}`);
  next();
}

//Checks authentication of incoming requests
async function authenticate(req, res, next) {
  const token = req.cookies.access_token;
  if (!token) { //No auth token yet - front end should treat this as a sign, so start google auth process
    logger.log(`Authentication failed for ${req.connection.remoteAddress}:${req.connection.remotePort}`);
    return res.status(401).json({ error: "Unauthorized: No token provided" }); 
  }
  try {
    // Use the token to fetch data from an external API
    const response = await axios.get(
      "https://www.googleapis.com/oauth2/v1/userinfo?alt=json",
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );
  } catch (error) {
    console.error("Failed to fetch protected data:", error.message);
    res.status(500).json({ error: "Failed to fetch data" });
  }
  //If no error occurs, it's safe to continue
  //res.json(response.data);
  next();
}


//Express app setup
const express = require("express");
const { json, urlencoded } = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const app = express();

//
//REQUEST RESOLUTION PATH
//

//Configuration middleware
const ACCEPTED_ORIGIN = "localhost:3000" //IP of static files server for production
const corsOptions = {
  origin: `http://${ACCEPTED_ORIGIN}`,
};
app.use(cors(corsOptions)); //CORS options specifications
app.use(json()); //Parse requests of content-type - application/json
app.use(urlencoded({ extended: true })); //*huh* : Parse requests of content-type - application/x-www-form-urlencoded
app.use(cookieParser());

//General middleware
app.use(logRequest);
const protected_routes = ["/home"]; //Includes all subroutes
app.use(protected_routes, authenticate);

//Specific route handlers
app.get("/trips", async (req, res) => {
  res.json(await getTrips());
});
app.get("/home", async (req, res) => {
  res.json(await getUserInfo("william_l_stone@brown.edu"));
});

//Default route handler
app.use(async (_req, res) => {
  res.json({ message: "Welcome to the BOC's data server! You are receiving this message because the route you requested did not match any of our defined ones." });
})

// set port, listen for requests
const PORT = process.env.PORT || 8080;
app.listen(PORT, async () => {
  await logger.start();
  logger.log(`STARTUP: Running on port ${PORT}.`);
});
