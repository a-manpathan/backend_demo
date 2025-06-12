import express from 'express';
import mysql from 'mysql2';
import cors from 'cors';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';
import speechToTextRoutes from './routes/speechToText.js';
import translationRoutes from './routes/translation.js';
import prescriptionRoutes from './routes/prescription.js';

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

// MySQL connection
const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  port: 3306
});

db.connect((err) => {
  if (err) {
    console.error('Error connecting to MySQL:', err);
    return;
  }
  console.log('Connected to MySQL');
});

// Signup endpoint
app.post('/api/signup', async (req, res) => {
  const { name, email, password, userType, specialization, hospital } = req.body;

  // Validate required fields
  if (!name || !email || !password || !userType) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (userType === 'doctor' && (!specialization || !hospital)) {
    return res.status(400).json({ error: 'Specialization and hospital required for doctors' });
  }
  if (userType !== 'admin' && userType !== 'doctor') {
    return res.status(400).json({ error: 'Invalid user type' });
  }

  try {
    // Hash password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Insert user into database
    const query = `
      INSERT INTO users (name, email, password, user_type, specialization, hospital)
      VALUES (?, ?, ?, ?, ?, ?)
    `;
    const values = [
      name,
      email,
      hashedPassword,
      userType,
      userType === 'doctor' ? specialization : null,
      userType === 'doctor' ? hospital : null
    ];

    db.query(query, values, (err, result) => {
      if (err) {
        if (err.code === 'ER_DUP_ENTRY') {
          return res.status(400).json({ error: 'Email already exists' });
        }
        return res.status(500).json({ error: 'Database error' });
      }
      res.status(201).json({ message: 'User created successfully', id: result.insertId });
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Login endpoint
app.post('/api/login', async (req, res) => {
  const { email, password, userType } = req.body;

  // Validate required fields
  if (!email || !password || !userType) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (userType !== 'admin' && userType !== 'doctor') {
    return res.status(400).json({ error: 'Invalid user type' });
  }

  try {
    // Query the database for the user
    const query = 'SELECT * FROM users WHERE email = ? AND user_type = ?';
    db.query(query, [email, userType], async (err, results) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      // Check if user exists
      if (results.length === 0) {
        return res.status(401).json({ error: 'Invalid email, user type, or password' });
      }

      const user = results[0];

      // Compare password
      const passwordMatch = await bcrypt.compare(password, user.password);
      if (!passwordMatch) {
        return res.status(401).json({ error: 'Invalid email, user type, or password' });
      }

      // Successful login
      res.status(200).json({
        message: 'Login successful',
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          userType: user.user_type
        }
      });
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.use('/api/speech', speechToTextRoutes);
app.use('/api/translate', translationRoutes);
app.use('/api/prescription', prescriptionRoutes);

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
