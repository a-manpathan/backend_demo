// Test script to create a doctor user for video call testing
import fetch from 'node-fetch';

const createTestDoctor = async () => {
  try {
    const response = await fetch('http://localhost:8000/api/signup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Dr. Test Doctor',
        email: 'testdoctor@example.com',
        password: 'testpassword123',
        userType: 'doctor',
        specialization: 'General Medicine',
        hospital: 'Test Hospital'
      })
    });

    const data = await response.json();
    
    if (response.ok) {
      console.log('✅ Test doctor created successfully!');
      console.log('Doctor ID:', data.id);
      console.log('ACS User ID:', data.acsUserId);
      console.log('\nYou can now test the video call feature.');
    } else {
      console.log('❌ Error creating doctor:', data.error);
    }
  } catch (error) {
    console.error('❌ Network error:', error.message);
  }
};

createTestDoctor();