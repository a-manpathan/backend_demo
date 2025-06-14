-- Database setup script for the healthcare management system
-- Run this script to create the necessary tables

-- Create users table
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  user_type ENUM('admin', 'doctor') NOT NULL,
  specialization VARCHAR(255) NULL,
  hospital VARCHAR(255) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Create index on email for faster lookups
CREATE INDEX idx_users_email ON users(email);

-- Create index on user_type for faster filtering
CREATE INDEX idx_users_type ON users(user_type);

-- Insert sample admin user (password: admin123)
INSERT IGNORE INTO users (name, email, password, user_type) VALUES 
('Admin User', 'admin@example.com', '$2b$10$rOzJqKqKqKqKqKqKqKqKqOzJqKqKqKqKqKqKqKqKqKqKqKqKqKqKq', 'admin');

-- Insert sample doctor user (password: doctor123)
INSERT IGNORE INTO users (name, email, password, user_type, specialization, hospital) VALUES 
('Dr. John Smith', 'doctor@example.com', '$2b$10$rOzJqKqKqKqKqKqKqKqKqOzJqKqKqKqKqKqKqKqKqKqKqKqKqKqKq', 'doctor', 'Cardiology', 'City Hospital');

-- Show tables to verify creation
SHOW TABLES;

-- Show users table structure
DESCRIBE users;
