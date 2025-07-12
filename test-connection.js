// Test backend connection
import fetch from 'node-fetch';

const testConnection = async () => {
  try {
    console.log('Testing backend connection...');
    const response = await fetch('https://backendgen-hgewftfphagrcbg7.southindia-01.azurewebsites.net/api/health');
    const data = await response.json();
    console.log('Backend status:', data);
    
    if (data.status === 'healthy') {
      console.log('✅ Backend is healthy, trying to create doctor...');
      
      const doctorResponse = await fetch('https://backendgen-hgewftfphagrcbg7.southindia-01.azurewebsites.net/api/signup', {
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

      const doctorData = await doctorResponse.json();
      console.log('Doctor creation response:', doctorData);
    }
  } catch (error) {
    console.error('❌ Connection error:', error.message);
  }
};

testConnection();