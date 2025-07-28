import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const router = express.Router();

// Get API keys from environment variables
const AZURE_AI_API_KEY = process.env.AZURE_AI_API_KEY;
const AZURE_AI_ENDPOINT = process.env.AZURE_AI_ENDPOINT || 'https://gendem.cognitiveservices.azure.com/';

// Retry logic for API requests (same as prescription.js)
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

router.post('/analyze', async (req, res) => {
  try {
    const { transcript } = req.body;
    
    if (!transcript) {
      return res.status(400).json({ error: 'Transcript is required' });
    }

    if (!AZURE_AI_API_KEY) {
      return res.status(500).json({ error: 'Azure AI API key not configured' });
    }

    console.log('Analyzing transcript:', transcript.substring(0, 100) + '...');

    const systemPrompt = `You are a medical assistant analyzing patient transcripts. Based on the provided transcript, extract and organize the medical information.

IMPORTANT: You must respond with valid JSON only, no additional text or formatting.

Extract the following information:
1. Symptoms: All symptoms mentioned by the patient
2. Diagnosis: Potential diagnosis based on the symptoms described
3. Notes: Important observations, medical history, and considerations

Format your response as valid JSON:
{
  "symptoms": ["symptom1", "symptom2", "symptom3"],
  "diagnosis": "Potential diagnosis based on symptoms",
  "notes": "Important observations, medical history, and other relevant information"
}

Ensure the JSON is properly formatted and contains meaningful medical information extracted from the transcript.`;

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
            content: `Please analyze the following patient transcript and extract symptoms, diagnosis, and notes:\n\n${transcript}`
          }
        ],
        max_tokens: 1000,
        temperature: 0.3, // Lower temperature for more consistent medical analysis
        top_p: 0.9,
      },
      {
        'Content-Type': 'application/json',
        'api-key': AZURE_AI_API_KEY,
      }
    );

    const aiResponse = response.data.choices[0].message.content.trim();
    
    console.log('AI Response received:', aiResponse.substring(0, 200) + '...');

    // Parse the JSON response
    let analysis;
    try {
      analysis = JSON.parse(aiResponse);
    } catch (parseError) {
      console.error('Failed to parse AI response as JSON:', parseError);
      console.error('Raw AI response:', aiResponse);
      
      // Fallback: try to extract information manually if JSON parsing fails
      throw new Error('AI response is not valid JSON format');
    }

    // Validate the response structure
    if (!analysis.symptoms || !analysis.diagnosis || !analysis.notes) {
      console.error('Invalid response structure:', analysis);
      throw new Error('AI response missing required fields (symptoms, diagnosis, notes)');
    }

    console.log('Transcript analysis completed successfully');
    
    res.json({
      symptoms: analysis.symptoms,
      diagnosis: analysis.diagnosis,
      notes: analysis.notes,
      analyzedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('Transcript analysis error:', error.response?.data || error.message);
    
    if (error.response) {
      res.status(error.response.status).json({ 
        error: 'Transcript analysis failed', 
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
        error: 'Transcript analysis failed', 
        details: error.message 
      });
    }
  }
});

router.post('/summarize', async (req, res) => {
  try {
    const { transcript } = req.body;
    
    if (!transcript) {
      return res.status(400).json({ error: 'Transcript is required' });
    }

    if (!AZURE_AI_API_KEY) {
      return res.status(500).json({ error: 'Azure AI API key not configured' });
    }

    console.log('Generating summary for transcript:', transcript.substring(0, 100) + '...');

    const systemPrompt = `You are a medical assistant that creates concise summaries of patient-doctor conversations. 

Analyze the provided transcript and create a brief, professional summary that captures:
1. Main health concerns or symptoms discussed
2. Key points from the conversation
3. Any important medical information mentioned
4. Overall context of the consultation

Keep the summary concise (2-4 sentences) and focus on the most important medical information discussed.`;

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
            content: `Please create a concise summary of this patient-doctor conversation:\n\n${transcript}`
          }
        ],
        max_tokens: 300,
        temperature: 0.3,
        top_p: 0.9,
      },
      {
        'Content-Type': 'application/json',
        'api-key': AZURE_AI_API_KEY,
      }
    );

    const summary = response.data.choices[0].message.content.trim();
    
    console.log('Summary generated successfully');
    
    res.json({
      summary: summary,
      summarizedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('Summary generation error:', error.response?.data || error.message);
    
    if (error.response) {
      res.status(error.response.status).json({ 
        error: 'Summary generation failed', 
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
        error: 'Summary generation failed', 
        details: error.message 
      });
    }
  }
});

export default router;