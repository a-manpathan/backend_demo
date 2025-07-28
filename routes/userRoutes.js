import express from 'express';
import bcrypt from 'bcrypt';
import sql from 'mssql';
import { CommunicationIdentityClient } from '@azure/communication-identity';

const router = express.Router();

export default (dbPool, identityClient) => {
  // Signup endpoint
  router.post('/signup', async (req, res) => {
    const { name, email, password, userType, specialization, hospital } = req.body;

    if (!name || !email || !password || !userType) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    if (userType === 'doctor' && (!specialization || !hospital)) {
      return res.status(400).json({ error: 'Specialization and hospital required for doctors' });
    }
    
    if (!['admin', 'doctor', 'patient'].includes(userType)) {
      return res.status(400).json({ error: 'Invalid user type' });
    }

    try {
      const request = dbPool.request();
      const existingUser = await request
        .input('email', sql.NVarChar, email)
        .query('SELECT id FROM users WHERE email = @email');
      
      if (existingUser.recordset.length > 0) {
        return res.status(400).json({ error: 'Email already exists' });
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      // Create ACS identity
      const userIdentity = await identityClient.createUser();
      const acsUserId = userIdentity.communicationUserId;

      const result = await request
        .input('name', sql.NVarChar, name)
        .input('email', sql.NVarChar, email)
        .input('password', sql.NVarChar, hashedPassword)
        .input('userType', sql.NVarChar, userType)
        .input('specialization', sql.NVarChar, userType === 'doctor' ? specialization : null)
        .input('hospital', sql.NVarChar, userType === 'doctor' ? hospital : null)
        .input('acsUserId', sql.NVarChar, acsUserId)
        .query(`
          INSERT INTO users (name, email, password, user_type, specialization, hospital, acs_user_id)
          OUTPUT INSERTED.id
          VALUES (@name, @email, @password, @userType, @specialization, @hospital, @acsUserId)
        `);

      res.status(201).json({ 
        message: 'User created successfully', 
        id: result.recordset[0].id,
        acsUserId: acsUserId
      });
    } catch (error) {
      console.error('Signup error:', error.message);
      res.status(500).json({ error: 'Server error occurred' });
    }
  });

  // Login endpoint
  router.post('/login', async (req, res) => {
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

      res.json({ message: 'Login successful', user: { id: user.id, name: user.name, email: user.email, userType: user.user_type } });
    } catch (error) {
      console.error('Login error:', error.message);
      res.status(500).json({ error: 'Server error occurred' });
    }
  });

  return router;
};