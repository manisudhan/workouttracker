// At the top of your server file
require('dotenv').config();
const express = require("express");
const { Pool } = require("pg");
const bcrypt = require("bcrypt");
const cors = require("cors");
const jwt = require("jsonwebtoken");
// ... rest of your imports // 1. Import jsonwebtoken


const app = express();
// --- Replace app.use(cors()); with this ---


const allowedOrigins = [
  'https://workk.digital',
  'https://www.workk.digital'
];

app.use(cors({
  origin: function (origin, callback) {
    // allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) === -1) {
      return callback(new Error('CORS policy block'), false);
    }
    return callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Add this right below your cors config to handle the "Preflight" test
app.options('(.*)', cors()); // ✅ FIXED: Changed '*' to '(.*)' to fix the PathError crash
app.use(express.json());

const { OAuth2Client } = require("google-auth-library");

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);


const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // CRITICAL: This is required to securely connect to cloud databases like Supabase
  }
});

// 2. Add a "secret key". This should be in a .env file, but we'll hardcode it for this example.
// This key MUST be kept secret!
const JWT_SECRET = process.env.JWT_SECRET;

// Add this function in server.js
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Format is "Bearer TOKEN"

  if (token == null) {
    return res.sendStatus(401); // No token, unauthorized
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.sendStatus(403); // Token is no longer valid
    }
    
    // 💡 IMPORTANT: We attach the user's payload to the request object
    req.user = user; 
    
    next(); // Proceed to the route
  });
};
app.post("/google-login", async (req, res) => {
  console.log("🔥 Google login hit");

  try {
    const ticket = await client.verifyIdToken({
      idToken: req.body.token,
      audience: "659772709176-mdi6b6mf7q2ncl2bgm6jgjs8vd6695sm.apps.googleusercontent.com",
    });

    const payload = ticket.getPayload();
    const googleEmail = payload.email; // We will use their Google email as their username

    // 1. Check if this Google user already exists in your PostgreSQL database
    let result = await pool.query(
      "SELECT * FROM users WHERE username = $1",
      [googleEmail]
    );

    let user;

    if (result.rows.length === 0) {
      // 2. If they don't exist, create a new user!
      // Since they use Google, they don't have a password. We generate a random one 
      // so your database doesn't crash from a missing password constraint.
      const dummyPassword = await bcrypt.hash(Math.random().toString(36), 10);
      
      const insertResult = await pool.query(
        "INSERT INTO users (username, password) VALUES ($1, $2) RETURNING *",
        [googleEmail, dummyPassword]
      );
      user = insertResult.rows[0];
      console.log("✅ New Google user registered in DB");
    } else {
      // User already exists
      user = result.rows[0];
      console.log("✅ Existing Google user found in DB");
    }

    // 3. Create a REAL JWT Payload using their database ID
    const jwtPayload = {
      id: user.id, 
      username: user.username,
    };

    // 4. Sign the real token
    const token = jwt.sign(jwtPayload, JWT_SECRET, {
      expiresIn: "1d", 
    });

    // 5. Send the real token back to the client
    res.json({ message: "Google Login successful ✅", token: token });

  } catch (err) {
    console.error("❌ Google verify error:", err.message);
    res.status(401).json({ message: "Invalid Google token" });
  }
});

// ✅ UPDATED: /login route
app.post("/login", async (req, res) => {
  const { username, password } = req.body;

  try {
    const result = await pool.query(
      "SELECT * FROM users WHERE username = $1",
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ message: "Invalid username or password" });
    }

    const user = result.rows[0];
    const passwordMatch = await bcrypt.compare(password, user.password);

    if (passwordMatch) {
      // 3. Create the JWT payload
      const payload = {
        id: user.id, // Assuming your users table has an 'id' column
        username: user.username,
      };

      // 4. Sign the token
      const token = jwt.sign(payload, JWT_SECRET, {
        expiresIn: "1d", // Token will expire in 1 day
      });

      // 5. Send the token back to the client
      res.json({ message: "Login successful ✅", token: token });
      
    } else {
      res.status(401).json({ message: "Invalid username or password" });
    }
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ message: "Server error" });
  }
});




// ✅ Test connection
pool.connect()
  .then(() => console.log("Connected to PostgreSQL ✅"))
  .catch(err => console.error("Connection error ❌", err.stack));


// 🧾 Register a new user
app.post("/register", async (req, res) => {
  const { username, password } = req.body;

  try {
    const existingUser = await pool.query(
      "SELECT * FROM users WHERE username = $1",
      [username]
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).send("User already exists");
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await pool.query(
      "INSERT INTO users (username, password) VALUES ($1, $2)",
      [username, hashedPassword]
    );

    res.status(201).send("User registered successfully ✅");
  } catch (err) {
    console.error("Register error:", err);
    res.status(500).send("Server error");
  }
});





// 📄 Get all users (optional)
app.get("/users", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM users");
    res.json(result.rows);
  } catch (err) {
    console.error("Fetch error:", err);
    res.status(500).send("Error fetching users");
  }
});


// ✅ Add a new meal entry
app.post("/api/meals",authenticateToken ,async (req, res) => {
  try {
    const { food, calories,protein } = req.body;
    const date = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
    const userid = req.user.id;

    await pool.query(
      "INSERT INTO calorie_logs (date, food, calories,protein,userid) VALUES ($1, $2, $3,$4,$5)",
      [date, food, calories,protein,userid]
    );

    res.json({ message: "Meal added successfully!" });
  } catch (error) {
    console.error("❌ Database insert failed:", error.message);
    res.status(500).json({ error: error.message });
  }
});


// ✅ Fetch meals for today
app.get("/api/meals",authenticateToken, async (req, res) => {
  try {
    const date = new Date().toISOString().split("T")[0];
    const userid = req.user.id;
    const result = await pool.query("SELECT * FROM calorie_logs WHERE date = $1 AND userid = $2" , [date,userid]);
    res.json(result.rows);
  } catch (error) {
    console.error("❌ Database fetch failed:", error.message);
    res.status(500).json({ error: "Database fetch failed" });
  }
});


// ✅ DELETE today’s meals (for “Clear” button)
app.delete("/api/meals",authenticateToken, async (req, res) => {
  try {
    const date = new Date().toISOString().split("T")[0];
    await pool.query("DELETE FROM calorie_logs WHERE date = $1", [date]);
    res.json({ message: "All meals for today cleared ✅" });
  } catch (error) {
    console.error("❌ Delete failed:", error.message);
    res.status(500).json({ error: "Failed to delete meals" });
  }
});

// Add these two new routes in server.js

// 🚀 GET user info
app.get("/api/userinfo", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id; // Get user ID from the token

    const result = await pool.query(
      "SELECT * FROM userinfo WHERE user_id = $1",
      [userId]
    );

    if (result.rows.length > 0) {
      res.json(result.rows[0]); // Send back the user's info
    } else {
      res.json({}); // Send back an empty object if no info exists yet
    }
  } catch (err) {
    console.error("❌ GET /api/userinfo error:", err.message);
    res.status(500).json({ message: "Server error" });
  }
});

// 🚀 POST (save/update) user info
app.post("/api/userinfo", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      height_cm,
      weight_kg,
      age,
      target_weight_kg,
      maintenance_calories,
      target_calories,
    } = req.body;

    // This is an "UPSERT" command.
    // It tries to INSERT a new row.
    // If a row with the same `user_id` already exists (ON CONFLICT),
    // it will UPDATE that existing row instead.
    const query = `
      INSERT INTO userinfo (
        user_id, height_cm, weight_kg, age, target_weight_kg, 
        maintenance_calories, target_calories, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
      ON CONFLICT (user_id) 
      DO UPDATE SET
        height_cm = EXCLUDED.height_cm,
        weight_kg = EXCLUDED.weight_kg,
        age = EXCLUDED.age,
        target_weight_kg = EXCLUDED.target_weight_kg,
        maintenance_calories = EXCLUDED.maintenance_calories,
        target_calories = EXCLUDED.target_calories,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *;
    `;

    const values = [
      userId,
      height_cm,
      weight_kg,
      age,
      target_weight_kg,
      maintenance_calories,
      target_calories,
    ];

    const result = await pool.query(query, values);
    res.status(200).json(result.rows[0]); // Send back the saved data

  } catch (err) {
    console.error("❌ POST /api/userinfo error:", err.message);
    res.status(500).json({ message: "Server error" });
  }
});

// --- ADD THESE NEW WORKOUT ENDPOINTS to your server.js ---
//
// This code assumes your 'authenticateToken' middleware and 'pool'
// variable are already in server.js.

// -----------------------------------------------------------------
// 1. HELPER FUNCTION
// -----------------------------------------------------------------
// This function is crucial. It finds or creates a "workout" for the
// day, so we can get a `workout_id` to link our sets to.
// (This is what implements your `workouts` table logic)
// -----------------------------------------------------------------
const getOrCreateWorkoutId = async (userId, date) => {
  // 1. Check if a workout for this user and date already exists
  const findQuery = "SELECT id FROM workouts WHERE userid = $1 AND date = $2";
  const findResult = await pool.query(findQuery, [userId, date]);

  if (findResult.rows.length > 0) {
    // 2. If it exists, return the ID
    return findResult.rows[0].id;
  } else {
    // 3. If it doesn't exist, create a new one
    const insertQuery =
      "INSERT INTO workouts (userid, date) VALUES ($1, $2) RETURNING id";
    const insertResult = await pool.query(insertQuery, [userId, date]);
    // 4. Return the new ID
    return insertResult.rows[0].id;
  }
};

// -----------------------------------------------------------------
// 2. LOG A NEW SET (This fixes your error!)
// -----------------------------------------------------------------
// This is the route that saves your log to the database.
// POST /api/workouts/sets
// -----------------------------------------------------------------
app.post("/api/workouts/sets", authenticateToken, async (req, res) => {
  const { exerciseName, reps, weight } = req.body;
  const userId = req.user.id; // Get user ID from the token
  const date = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

  // Check for required fields
  if (!exerciseName || reps == null) {
    return res.status(400).json({ message: "Exercise Name and Reps are required." });
  }

  try {
    // 1. Get the workout_id for today (from your helper function)
    const workoutId = await getOrCreateWorkoutId(userId, date);

    // 2. Now, insert the set into the `workout_sets` table
    const insertSetQuery = `
      INSERT INTO workout_sets (workout_id, exercise_name, reps, weight_kg)
      VALUES ($1, $2, $3, $4)
      RETURNING *;
    `;
    const newSet = await pool.query(insertSetQuery, [
      workoutId,
      exerciseName,
      reps,
      weight,
    ]);

    // Send back the new set as confirmation
    res.status(201).json(newSet.rows[0]);
  } catch (err) {
    console.error("❌ POST /api/workouts/sets error:", err.message);
    res.status(500).json({ message: "Server error while logging set" });
  }
});

// -----------------------------------------------------------------
// 3. GET UNIQUE EXERCISES FOR DROPDOWN
// -----------------------------------------------------------------
// This route fetches the list of *your* logged exercises
// for the "Track Progress" dropdown.
// GET /api/workouts/exercises
// -----------------------------------------------------------------
app.get("/api/workouts/exercises", authenticateToken, async (req, res) => {
  const userId = req.user.id;

  try {
    // This query joins your tables to find all unique exercise names
    // for just this user.
    const query = `
      SELECT DISTINCT ws.exercise_name
      FROM workout_sets ws
      JOIN workouts w ON ws.workout_id = w.id
      WHERE w.userid = $1
      ORDER BY ws.exercise_name;
    `;
    const result = await pool.query(query, [userId]);

    // Convert the array of objects (e.g., [{exercise_name: "Squat"}])
    // into a simple array of strings (e.g., ["Squat"])
    const exerciseNames = result.rows.map((row) => row.exercise_name);
    
    res.json(exerciseNames);
  } catch (err) {
    console.error("❌ GET /api/workouts/exercises error:", err.message);
    res.status(500).json({ message: "Server error fetching exercises" });
  }
});

// -----------------------------------------------------------------
// 4. GET VOLUME DATA FOR THE CHART
// -----------------------------------------------------------------
// This route fetches the data for your line/bar chart.
// GET /api/workouts/volume?exercise=...
// -----------------------------------------------------------------
app.get("/api/workouts/volume", authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const { exercise } = req.query; // e.g., "Bench Press"

  if (!exercise) {
    return res.status(400).json({ message: "Exercise query parameter is required." });
  }

  try {
    // This is the SQL query from our original discussion.
    // It groups by date and sums the volume for one exercise.
    const query = `
      SELECT
        w.date,
        -- Calculate total volume for *just this exercise* on this day
        SUM(ws.reps * COALESCE(ws.weight_kg, 0)) AS volume
      FROM
        workouts w
      JOIN
        workout_sets ws ON w.id = ws.workout_id
      WHERE
        w.userid = $1
        AND ws.exercise_name = $2
      GROUP BY
        w.date
      ORDER BY
        w.date ASC;
    `;
    const result = await pool.query(query, [userId, exercise]);

    // Convert string 'volume' to a number for the chart
    const chartData = result.rows.map(row => ({
      date: new Date(row.date).toLocaleDateString(), // Format the date nicely
      volume: parseFloat(row.volume)
    }));
    
    res.json(chartData);
  } catch (err) {
    console.error("❌ GET /api/workouts/volume error:", err.message);
    res.status(500).json({ message: "Server error fetching volume data" });
  }
});






// 1. POST route to save a new daily weight
// ADDED 'authenticateToken' here!
app.post('/api/weight-history', authenticateToken, async (req, res) => {
  try {
    const { weight, date } = req.body;
    const userId = req.user.id; // This will work now!

    // Insert into your new table
    const query = `
      INSERT INTO weight_history (user_id, weight, logged_date) 
      VALUES ($1, $2, $3)
    `;
    // CHANGED 'db.query' to 'pool.query'
    await pool.query(query, [userId, weight, date]); 

    res.status(201).json({ message: "Weight saved to database!" });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: "Database error while saving weight" });
  }
});

// 2. GET route to fetch history for the graph
// ADDED 'authenticateToken' here!
app.get('/api/weight-history', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id; 

    // Fetch the logged weights for this specific user, ordered by oldest to newest
    const query = `
      SELECT logged_date as date, weight 
      FROM weight_history 
      WHERE user_id = $1 
      ORDER BY created_at ASC
    `;
    // CHANGED 'db.query' to 'pool.query'
    const result = await pool.query(query, [userId]);

    // Send the array of data back to your React graph
    res.status(200).json(result.rows); 
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: "Database error while fetching history" });
  }
});


// 🚀 Start server
const PORT = 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));