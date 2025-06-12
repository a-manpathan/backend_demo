import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const router = express.Router();

// Get API key from environment variables
const GOOGLE_API_KEY = process.env.GOOGLE_APPLICATION_CREDENTIALS;

router.post('/transcribe', async (req, res) => {
  try {
    const { audioContent, languageCode = 'en-US' } = req.body;

    if (!audioContent) {
      return res.status(400).json({ error: 'Audio content is required' });
    }

    if (!GOOGLE_API_KEY) {
      return res.status(500).json({ error: 'Google API key not configured' });
    }

    console.log('Received transcription request for language:', languageCode);

    // Try different audio configurations based on common browser formats
    const audioConfigs = [
      {
        encoding: 'WEBM_OPUS',
        sampleRateHertz: 48000,
        description: 'WebM Opus'
      },
      {
        encoding: 'OGG_OPUS',
        sampleRateHertz: 48000,
        description: 'OGG Opus'
      },
      {
        encoding: 'LINEAR16',
        sampleRateHertz: 16000,
        description: 'Linear16'
      },
      {
        encoding: 'FLAC',
        sampleRateHertz: 48000,
        description: 'FLAC'
      }
    ];

    let response;
    let lastError;

    // Try each configuration until one works
    for (const config of audioConfigs) {
      try {
        console.log(`Trying ${config.description} format...`);

        response = await axios.post(
          `https://speech.googleapis.com/v1/speech:recognize?key=${GOOGLE_API_KEY}`,
          {
            config: {
              encoding: config.encoding,
              sampleRateHertz: config.sampleRateHertz,
              languageCode: languageCode,
              enableAutomaticPunctuation: true,
              model: 'latest_long',
            },
            audio: {
              content: audioContent,
            },
          },
          {
            headers: {
              'Content-Type': 'application/json',
            },
            timeout: 30000,
          }
        );

        console.log(`Success with ${config.description} format`);
        break; // Success, exit the loop

      } catch (error) {
        console.log(`Failed with ${config.description}:`, error.response?.data?.error || error.message);
        lastError = error;
        continue; // Try next configuration
      }
    }

    // If all configurations failed, throw the last error
    if (!response) {
      throw lastError;
    }

    const transcription = response.data.results
      ? response.data.results.map(result => result.alternatives[0].transcript).join(' ')
      : '';

    console.log('Transcription successful:', transcription.substring(0, 100) + '...');
    res.json({ transcript: transcription });
  } catch (error) {
    console.error('Speech-to-text error:', error.response?.data || error.message);

    // Provide more detailed error information
    if (error.response) {
      res.status(error.response.status).json({
        error: 'Speech recognition failed',
        details: error.response.data,
        status: error.response.status
      });
    } else if (error.request) {
      res.status(500).json({
        error: 'Network error - unable to reach Google Speech API',
        details: error.message
      });
    } else {
      res.status(500).json({
        error: 'Speech recognition failed',
        details: error.message
      });
    }
  }
});

export default router;
