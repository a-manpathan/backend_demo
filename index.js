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
    encrypt: true,
    trustServerCertificate: false,
    connectTimeout: 30000,
    requestTimeout: 30000,
    cancelTimeout: 5000,
    pool: {
      max: 20, // Increased pool size
      min: 2,  // Keep minimum connections
      idleTimeoutMillis: 60000, // Increased idle timeout
      acquireTimeoutMillis: 30000,
      createTimeoutMillis: 30000,
      destroyTimeoutMillis: 5000,
      reapIntervalMillis: 1000,
      createRetryIntervalMillis: 200,
    },
    enableArithAbort: true,
    abortTransactionOnError: true,
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
    console.log('Creating tables if they don’t exist...');

    const createUsersTable = `
      IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'users')
      BEGIN
        CREATE TABLE users (
          id INT IDENTITY(1,1) PRIMARY KEY,
          name NVARCHAR(255) NOT NULL,
          email NVARCHAR(255) UNIQUE NOT NULL,
          password NVARCHAR(255) NOT NULL,
          user_type NVARCHAR(50) NOT NULL,
          CONSTRAINT CK_users_user_type CHECK (user_type IN ('admin', 'doctor', 'patient')),
          specialization NVARCHAR(255) NULL,
          hospital NVARCHAR(255) NULL,
          created_at DATETIME2 DEFAULT GETDATE(),
          updated_at DATETIME2 DEFAULT GETDATE()
        );
      END;

      IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'doctors')
      BEGIN
        CREATE TABLE doctors (
          id INT IDENTITY(1,1) PRIMARY KEY,
          id_number NVARCHAR(50) NOT NULL,
          name NVARCHAR(255) NOT NULL,
          email NVARCHAR(255) UNIQUE NOT NULL,
          specialization NVARCHAR(255) NOT NULL,
          location NVARCHAR(255) NOT NULL,
          contact NVARCHAR(50) NOT NULL,
          status NVARCHAR(50) DEFAULT 'Active',
          image_url NVARCHAR(MAX),
          join_date DATE DEFAULT GETDATE()
        );
      END;
    `;

    const request = dbPool.request();
    await request.query(createUsersTable);
    console.log('✅ Users and Doctors tables ready');

    // Check if the CHECK constraint needs updating
    const checkConstraintQuery = `
      SELECT name
      FROM sys.check_constraints
      WHERE parent_object_id = OBJECT_ID('users')
      AND definition NOT LIKE '%patient%';
    `;

    const constraintResult = await request.query(checkConstraintQuery);

    if (constraintResult.recordset.length > 0) {
      const constraintName = constraintResult.recordset[0].name;
      console.log(`Found outdated constraint: ${constraintName}`);

      const updateConstraint = `
        ALTER TABLE users DROP CONSTRAINT [${constraintName}];
        ALTER TABLE users ADD CONSTRAINT CK_users_user_type CHECK (user_type IN ('admin', 'doctor', 'patient'));
      `;
      await request.query(updateConstraint);
      console.log('✅ User type constraint updated');
    } else {
      console.log('✅ No constraint update needed');
    }
  } catch (err) {
    console.error('❌ Error creating users or doctors table:', err);
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
  const { name, email, password, userType, specialization, hospital } = req.body;

  // Validation
  if (!name || !email || !password || !userType) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  if (userType === 'doctor' && (!specialization || !hospital)) {
    return res.status(400).json({ error: 'Specialization and hospital required for doctors' });
  }
  
  if (!['admin', 'doctor', 'patient'].includes(userType)) {
    return res.status(400).json({ error: 'Invalid user type' });
  }

  let request;
  try {
    // Check if email exists first (optimized query)
    request = dbPool.request();
    const existingUser = await request
      .input('email', sql.NVarChar, email)
      .query('SELECT id FROM users WHERE email = @email');
    
    if (existingUser.recordset.length > 0) {
      return res.status(400).json({ error: 'Email already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    request = dbPool.request();
    const result = await request
      .input('name', sql.NVarChar, name)
      .input('email', sql.NVarChar, email)
      .input('password', sql.NVarChar, hashedPassword)
      .input('userType', sql.NVarChar, userType)
      .input('specialization', sql.NVarChar, userType === 'doctor' ? specialization : null)
      .input('hospital', sql.NVarChar, userType === 'doctor' ? hospital : null)
      .query(`
        INSERT INTO users (name, email, password, user_type, specialization, hospital)
        OUTPUT INSERTED.id
        VALUES (@name, @email, @password, @userType, @specialization, @hospital)
      `);

    res.status(201).json({ 
      message: 'User created successfully', 
      id: result.recordset[0].id 
    });
    
  } catch (error) {
    console.error('Signup error:', error.message);
    res.status(500).json({ error: 'Server error occurred' });
  }
});

// Login endpoint with connection check
app.post('/api/login', checkDbConnection, async (req, res) => {
  const { email, password, userType } = req.body;

  if (!email || !password || !userType) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  if (!['admin', 'doctor', 'patient'].includes(userType)) {
    return res.status(400).json({ error: 'Invalid user type' });
  }

  try {
    const request = dbPool.request();
    const result = await request
      .input('email', sql.NVarChar, email)
      .input('userType', sql.NVarChar, userType)
      .query('SELECT id, name, email, password, user_type FROM users WHERE email = @email AND user_type = @userType');

    if (result.recordset.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.recordset[0];
    const passwordMatch = await bcrypt.compare(password, user.password);
    
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    res.json({
      message: 'Login successful',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        userType: user.user_type,
      },
    });
  } catch (error) {
    console.error('Login error:', error.message);
    res.status(500).json({ error: 'Server error occurred' });
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