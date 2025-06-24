import express from 'express';
import sql from 'mssql';
import cors from 'cors';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';
import speechToTextRoutes from './routes/speechToText.js';
import translationRoutes from './routes/translation.js';
import prescriptionRoutes from './routes/prescription.js';
import transcriptAnalysisRoutes from './routes/transcriptAnalysis.js';

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

// Azure SQL Database connection configuration
const dbConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_HOST,
  database: process.env.DB_DATABASE,
  port: parseInt(process.env.DB_PORT) || 1433,
  options: {
    encrypt: true, // Required for Azure SQL
    trustServerCertificate: false,
    connectTimeout: 30000, // Increased to 30 seconds
    requestTimeout: 30000, // Added request timeout
    cancelTimeout: 5000, // Added cancel timeout
    pool: {
      max: 10,
      min: 0,
      idleTimeoutMillis: 30000,
    },
  },
};

// Global connection pool
let dbPool = null;
let isConnected = false;

const connectDb = async () => {
  try {
    console.log('Attempting to connect to Azure SQL Database...');
    console.log('Server:', process.env.DB_HOST);
    console.log('Database:', process.env.DB_DATABASE);
    console.log('User:', process.env.DB_USER);
    
    if (dbPool) {
      await dbPool.close();
    }
    
    dbPool = new sql.ConnectionPool(dbConfig);
    
    // Add error handler before connecting
    dbPool.on('error', (err) => {
      console.error('Azure SQL Pool Error:', err);
      isConnected = false;
      if (err.code === 'ETIMEDOUT' || err.code === 'ECONNRESET' || err.code === 'ECONNCLOSED') {
        console.log('Connection lost. Attempting to reconnect in 5 seconds...');
        setTimeout(() => {
          connectDb();
        }, 5000);
      }
    });

    await dbPool.connect();
    isConnected = true;
    console.log('✅ Successfully connected to Azure SQL Database');
    
    // Create tables after successful connection
    await createTablesIfNotExist();
    
  } catch (err) {
    isConnected = false;
    console.error('❌ Error connecting to Azure SQL Database:', {
      code: err.code,
      message: err.message,
      originalError: err.originalError?.message || 'No additional details'
    });
    
    // Log specific troubleshooting info
    if (err.code === 'ETIMEOUT') {
      console.log('🔧 Troubleshooting tips:');
      console.log('1. Check if your IP is whitelisted in Azure SQL firewall rules');
      console.log('2. Verify server name and database name are correct');
      console.log('3. Ensure Azure SQL server is running and accessible');
      console.log('4. Check if you\'re behind a corporate firewall blocking port 1433');
    }
    
    // Retry connection after 10 seconds
    setTimeout(() => {
      console.log('Retrying database connection...');
      connectDb();
    }, 10000);
  }
};

// Create tables function
const createTablesIfNotExist = async () => {
  if (!isConnected || !dbPool) {
    console.log('⚠️ Skipping table creation - database not connected');
    return;
  }

  try {
    console.log('Creating tables if they don\'t exist...');
    
    const createUsersTable = `
      IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'users')
      BEGIN
        CREATE TABLE users (
          id INT IDENTITY(1,1) PRIMARY KEY,
          name NVARCHAR(255) NOT NULL,
          email NVARCHAR(255) UNIQUE NOT NULL,
          password NVARCHAR(255) NOT NULL,
          user_type NVARCHAR(50) NOT NULL
            CHECK (user_type IN ('admin', 'doctor')),
          specialization NVARCHAR(255) NULL,
          hospital NVARCHAR(255) NULL,
          created_at DATETIME2 DEFAULT GETDATE(),
          updated_at DATETIME2 DEFAULT GETDATE()
        );
      END;
    `;

    const request = dbPool.request();
    await request.query(createUsersTable);
    console.log('✅ Users table ready');
    
  } catch (err) {
    console.error('❌ Error creating users table:', err);
  }
};

// Initialize database connection
connectDb();

// Health check endpoint with better error handling
app.get('/api/health', async (req, res) => {
  try {
    if (!isConnected || !dbPool) {
      return res.status(503).json({
        status: 'unhealthy',
        database: 'disconnected',
        message: 'Database connection not established',
        timestamp: new Date().toISOString(),
      });
    }

    // Test the connection with a simple query
    const request = dbPool.request();
    await request.query('SELECT 1 as test');
    
    res.json({
      status: 'healthy',
      database: 'connected',
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Health check error:', err);
    res.status(503).json({
      status: 'unhealthy',
      database: 'error',
      error: err.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// Middleware to check database connection
const checkDbConnection = (req, res, next) => {
  if (!isConnected || !dbPool) {
    return res.status(503).json({ 
      error: 'Database connection not available. Please try again later.' 
    });
  }
  next();
};

// Signup endpoint with connection check
app.post('/api/signup', checkDbConnection, async (req, res) => {
  console.log('Signup request received:', req.body);
  const { name, email, password, userType, specialization, hospital } = req.body;

  if (!name || !email || !password || !userType) {
    console.log('Missing required fields:', {
      name: !!name,
      email: !!email,
      password: !!password,
      userType: !!userType,
    });
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  if (userType === 'doctor' && (!specialization || !hospital)) {
    console.log('Missing doctor fields:', {
      specialization: !!specialization,
      hospital: !!hospital,
    });
    return res.status(400).json({ error: 'Specialization and hospital required for doctors' });
  }
  
  if (userType !== 'admin' && userType !== 'doctor') {
    console.log('Invalid user type:', userType);
    return res.status(400).json({ error: 'Invalid user type' });
  }

  try {
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    console.log('Password hashed successfully');

    const request = dbPool.request();
    const query = `
      INSERT INTO users (name, email, password, user_type, specialization, hospital)
      OUTPUT INSERTED.id
      VALUES (@name, @email, @password, @userType, @specialization, @hospital)
    `;
    
    const result = await request
      .input('name', sql.NVarChar, name)
      .input('email', sql.NVarChar, email)
      .input('password', sql.NVarChar, hashedPassword)
      .input('userType', sql.NVarChar, userType)
      .input('specialization', sql.NVarChar, userType === 'doctor' ? specialization : null)
      .input('hospital', sql.NVarChar, userType === 'doctor' ? hospital : null)
      .query(query);

    const userId = result.recordset[0].id;
    console.log('User created successfully with ID:', userId);
    res.status(201).json({ message: 'User created successfully', id: userId });
    
  } catch (error) {
    console.error('Server error in signup:', error);
    if (error.message && error.message.includes('Violation of UNIQUE KEY constraint')) {
      return res.status(400).json({ error: 'Email already exists' });
    }
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
});

// Login endpoint with connection check
app.post('/api/login', checkDbConnection, async (req, res) => {
  console.log('Login request received:', { email: req.body.email, userType: req.body.userType });
  const { email, password, userType } = req.body;

  if (!email || !password || !userType) {
    console.log('Missing required fields in login:', {
      email: !!email,
      password: !!password,
      userType: !!userType,
    });
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  if (userType !== 'admin' && userType !== 'doctor') {
    console.log('Invalid user type in login:', userType);
    return res.status(400).json({ error: 'Invalid user type' });
  }

  try {
    const request = dbPool.request();
    const query = 'SELECT * FROM users WHERE email = @email AND user_type = @userType';
    const result = await request
      .input('email', sql.NVarChar, email)
      .input('userType', sql.NVarChar, userType)
      .query(query);

    console.log('Login query results count:', result.recordset.length);

    if (result.recordset.length === 0) {
      return res.status(401).json({ error: 'Invalid email, user type, or password' });
    }

    const user = result.recordset[0];
    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      console.log('Password mismatch for user:', email);
      return res.status(401).json({ error: 'Invalid email, user type, or password' });
    }

    console.log('Login successful for user:', email);
    res.status(200).json({
      message: 'Login successful',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        userType: user.user_type,
      },
    });
  } catch (error) {
    console.error('Server error in login:', error);
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
});

app.get('/api/test', (req, res) => {
  res.json({
    message: 'Backend is working!',
    timestamp: new Date().toISOString(),
    database: isConnected ? 'connected' : 'disconnected',
    healthCheck: 'Check /api/health for detailed database status',
  });
});

// Route handlers
app.use('/api/speech', speechToTextRoutes);
app.use('/api/translate', translationRoutes);
app.use('/api/prescription', prescriptionRoutes);
app.use('/api/transcript', transcriptAnalysisRoutes);

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down gracefully...');
  if (dbPool) {
    await dbPool.close();
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Shutting down gracefully...');
  if (dbPool) {
    await dbPool.close();
  }
  process.exit(0);
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 Health check available at http://localhost:${PORT}/api/health`);
});