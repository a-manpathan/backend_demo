import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const router = express.Router();

// Get API keys from environment variables
const AZURE_AI_API_KEY = process.env.AZURE_AI_API_KEY;
const AZURE_AI_ENDPOINT = process.env.AZURE_AI_ENDPOINT || 'https://gendem.cognitiveservices.azure.com/';

// Retry logic for API requests
const retryRequest = async (url, data, headers, retries = 3, initialDelay = 2000) => {
  try {
    const response = await axios.post(url, data, { headers, timeout: 30000 });
    return response;
  } catch (error) {
    if (error.response && error.response.status === 429 && retries > 0) {
      if (error.response.data?.error?.message.includes('Quota exceeded')) {
        throw new Error('API quota exhausted. Please check your subscription.');
      }
      const retryAfter = error.response.headers['retry-after'] || initialDelay / 1000;
      const delay = retryAfter * 1000;
      console.log(`Rate limit exceeded. Retrying in ${delay / 1000}s (${retries} attempts left)`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return retryRequest(url, data, headers, retries - 1, initialDelay * 2);
    }
    throw error;
  }
};

router.post('/generate', async (req, res) => {
  try {
    const { symptoms, diagnosis, notes, patientInfo } = req.body;
    
    if (!symptoms && !diagnosis && !notes) {
      return res.status(400).json({ error: 'At least one of symptoms, diagnosis, or notes is required' });
    }

    if (!AZURE_AI_API_KEY) {
      return res.status(500).json({ error: 'Azure AI API key not configured' });
    }

    console.log('Generating prescription for:', {
      symptoms: symptoms?.substring(0, 100) + '...',
      diagnosis: diagnosis?.substring(0, 100) + '...',
      notes: notes?.substring(0, 100) + '...',
      patientInfo: patientInfo?.name || 'Unknown'
    });

    // Construct the prompt for prescription generation
    const patientContext = patientInfo ? `
Patient Information:
- Name: ${patientInfo.name || 'Not provided'}
- Age: ${patientInfo.age || 'Not provided'}
- Gender: ${patientInfo.gender || 'Not provided'}
- Medical History: ${patientInfo.medicalHistory || 'Not provided'}
- Allergies: ${patientInfo.allergies || 'None specified'}
` : '';

    const medicalData = `
${patientContext}
Symptoms: ${symptoms || 'Not provided'}
Diagnosis: ${diagnosis || 'Not provided'}
Additional Notes: ${notes || 'Not provided'}
`;

    const systemPrompt = `You are an experienced medical doctor assistant helping to generate a comprehensive prescription based on patient information. 

IMPORTANT DISCLAIMERS:
- This is for educational/reference purposes only
- Always recommend consulting with a licensed physician
- Do not provide specific medical advice for real patients

Based on the provided patient information, generate a detailed prescription with medications specifically tailored to the symptoms and diagnosis provided. DO NOT use generic medications like "Paracetamol 500mg - 1 tablet, 3 times a day after food for 3 days" and "Amoxicillin 250mg - 1 capsule, 2 times a day for 5 days" for every condition.

Generate the prescription in the following format:

**PRESCRIPTION**

**Patient Information:**
- Name: [Patient Name]
- Age: [Age]
- Date: [Current Date]

**Medications:**
[Generate 2-4 medications specifically appropriate for the symptoms and diagnosis provided. Each medication should be relevant to the condition being treated]
1. [Specific Medication Name] [Appropriate Strength]
   - Dosage: [Condition-specific amount and frequency]
   - Duration: [Appropriate treatment period]
   - Instructions: [Relevant special instructions]

2. [Additional condition-specific medications as needed]

**General Instructions:**
- [Lifestyle recommendations specific to the condition]
- [Dietary advice if applicable to the condition]
- [Follow-up recommendations]

**Warnings & Precautions:**
- [Important warnings specific to the medications prescribed]
- [Drug interactions to avoid]
- [When to seek immediate medical attention]

**Follow-up:**
- [Recommended follow-up timeline based on condition]
- [What to monitor for the specific condition]

Please ensure all recommendations are:
- Evidence-based and specifically appropriate for the symptoms/diagnosis provided
- Include proper dosages and frequencies for the specific condition
- Consider potential drug interactions and contraindications
- Include clear instructions for the patient
- Emphasize the need for professional medical consultation
- AVOID using the same generic medications for different conditions

Generate a professional, comprehensive prescription with condition-specific medications based on the provided information.`;

    const response = await retryRequest(
      `${AZURE_AI_ENDPOINT}/openai/deployments/gpt-4o-mini/chat/completions?api-version=2024-12-01-preview`,
      {
        messages: [
          {
            role: 'system',
            content: systemPrompt
          },
          {
            role: 'user',
            content: `Please generate a prescription based on the following medical information:\n\n${medicalData}`
          }
        ],
        max_tokens: 1500,
        temperature: 0.3, // Lower temperature for more consistent medical advice
        top_p: 0.9,
      },
      {
        'Content-Type': 'application/json',
        'api-key': AZURE_AI_API_KEY,
      }
    );

    const prescription = response.data.choices[0].message.content.trim();
    
    console.log('Prescription generated successfully');
    
    res.json({
      prescription: prescription,
      generatedAt: new Date().toISOString(),
      disclaimer: 'This prescription is generated for educational purposes only. Please consult with a licensed physician before taking any medication.'
    });

  } catch (error) {
    console.error('Prescription generation error:', error.response?.data || error.message);
    
    if (error.response) {
      res.status(error.response.status).json({ 
        error: 'Prescription generation failed', 
        details: error.response.data,
        status: error.response.status
      });
    } else if (error.request) {
      res.status(500).json({ 
        error: 'Network error - unable to reach Azure AI service', 
        details: error.message 
      });
    } else {
      res.status(500).json({ 
        error: 'Prescription generation failed', 
        details: error.message 
      });
    }
  }
});

export default router;
