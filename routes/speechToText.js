import express from 'express';
import axios from 'axios';
import {io} from './socketSetup.js';
import dotenv from 'dotenv';

dotenv.config();

const router = express.Router();
//const speechClient = new SpeechClient();

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
    console.log('Audio content size:', audioContent.length, 'characters');

    const audioConfigs = [
      { encoding: 'WEBM_OPUS', sampleRateHertz: 48000, description: 'WebM Opus' },
      { encoding: 'OGG_OPUS', sampleRateHertz: 48000, description: 'OGG Opus' },
      { encoding: 'LINEAR16', sampleRateHertz: 16000, description: 'Linear16' },
      { encoding: 'FLAC', sampleRateHertz: 48000, description: 'FLAC' }
    ];

    let response;
    let lastError;

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
            timeout: 60000, // Increased timeout for longer audio
            maxContentLength: 52428800, // 50MB
            maxBodyLength: 52428800, // 50MB
          }
        );

        console.log(`Success with ${config.description} format`);
        break;

      } catch (error) {
        console.log(`Failed with ${config.description}:`, error.response?.data?.error || error.message);
        lastError = error;
        continue;
      }
    }

    if (!response) {
      throw lastError;
    }

    const transcription = response.data.results
      ? response.data.results.map(result => result.alternatives[0].transcript).join(' ')
      : '';

    console.log('Transcription successful:', transcription.substring(0, 100) + '...');
    io.emit('transcript', transcription);
    res.json({ transcript: transcription });
  } catch (error) {
    console.error('Speech-to-text error:', error.response?.data || error.message);

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

router.post('/detect-language', async (req, res) => {
  try {
    const { audioContent } = req.body;
    if (!audioContent) {
      return res.status(400).json({ error: 'Audio content is required' });
    }
    if (!GOOGLE_API_KEY) {
      return res.status(500).json({ error: 'Google API key not configured' });
    }

    console.log('Received language detection request');

    // Define possible languages for detection
    const possibleLanguages = [
      'hi-IN', 'bn-IN', 'te-IN', 'ta-IN', 'mr-IN', 'gu-IN', 'kn-IN', 'ml-IN', 'pa-IN',
      'or-IN', 'as-IN', 'ur-IN', 'en-US', 'en-IN', 'fr-FR', 'de-DE', 'es-ES', 'it-IT',
      'zh-CN', 'ja-JP', 'ko-KR', 'th-TH', 'vi-VN', 'pt-PT', 'ru-RU'
    ];

    const audioConfigs = [
      { encoding: 'WEBM_OPUS', sampleRateHertz: 48000, description: 'WebM Opus' },
      { encoding: 'OGG_OPUS', sampleRateHertz: 48000, description: 'OGG Opus' },
      { encoding: 'LINEAR16', sampleRateHertz: 16000, description: 'Linear16' },
      { encoding: 'FLAC', sampleRateHertz: 48000, description: 'FLAC' }
    ];

    let bestResult = null;
    let bestConfidence = 0;
    let bestTranscript = '';
    let bestLanguage = null;

    // Try multiple approaches for better language detection
    for (const config of audioConfigs) {
      try {
        console.log(`Trying language detection with ${config.description} format...`);

        // Method 1: Use language detection without primary language bias
        const response = await axios.post(
          `https://speech.googleapis.com/v1/speech:recognize?key=${GOOGLE_API_KEY}`,
          {
            config: {
              encoding: config.encoding,
              sampleRateHertz: config.sampleRateHertz,
              // Don't set a primary languageCode to avoid bias
              languageCode: 'auto',
              alternativeLanguageCodes: possibleLanguages,
              enableAutomaticPunctuation: true,
              model: 'latest_short', // Use short model for faster detection
              enableLanguageDetection: true,
            },
            audio: { content: audioContent },
          },
          {
            headers: { 'Content-Type': 'application/json' },
            timeout: 30000,
          }
        );

        console.log(`Language detection response with ${config.description}:`, JSON.stringify(response.data, null, 2));

        if (response.data && response.data.results && response.data.results.length > 0) {
          const result = response.data.results[0];

          // Check if we have language detection results
          if (result.languageCode) {
            const confidence = result.alternatives?.[0]?.confidence || 0;
            const transcript = result.alternatives?.[0]?.transcript || '';

            console.log(`Detected language: ${result.languageCode}, confidence: ${confidence}`);

            if (confidence > bestConfidence) {
              bestResult = result;
              bestConfidence = confidence;
              bestTranscript = transcript;
              bestLanguage = result.languageCode;
            }
          }
        }

        // If we got a good result, break
        if (bestConfidence > 0.7) {
          console.log(`High confidence detection achieved: ${bestLanguage} (${bestConfidence})`);
          break;
        }

      } catch (error) {
        console.log(`Language detection failed with ${config.description}:`, error.response?.data?.error || error.message);

        // If 'auto' language code failed, try without it
        if (error.response?.data?.error?.message?.includes('auto')) {
          try {
            console.log(`Retrying ${config.description} without 'auto' language code...`);

            const fallbackResponse = await axios.post(
              `https://speech.googleapis.com/v1/speech:recognize?key=${GOOGLE_API_KEY}`,
              {
                config: {
                  encoding: config.encoding,
                  sampleRateHertz: config.sampleRateHertz,
                  alternativeLanguageCodes: possibleLanguages,
                  enableAutomaticPunctuation: true,
                  model: 'latest_short',
                },
                audio: { content: audioContent },
              },
              {
                headers: { 'Content-Type': 'application/json' },
                timeout: 30000,
              }
            );

            if (fallbackResponse.data && fallbackResponse.data.results && fallbackResponse.data.results.length > 0) {
              const result = fallbackResponse.data.results[0];
              if (result.languageCode) {
                const confidence = result.alternatives?.[0]?.confidence || 0;
                const transcript = result.alternatives?.[0]?.transcript || '';

                if (confidence > bestConfidence) {
                  bestResult = result;
                  bestConfidence = confidence;
                  bestTranscript = transcript;
                  bestLanguage = result.languageCode;
                }
              }
            }
          } catch (fallbackError) {
            console.log(`Fallback also failed for ${config.description}:`, fallbackError.response?.data?.error || fallbackError.message);
          }
        }
        continue;
      }
    }

    console.log('Final language detection result:', {
      language: bestLanguage,
      confidence: bestConfidence,
      transcript: bestTranscript ? bestTranscript.substring(0, 50) + '...' : 'No transcript'
    });

    if (bestLanguage && bestConfidence > 0.3) { // Lower threshold for acceptance
      res.json({
        language: bestLanguage,
        confidence: bestConfidence,
        transcript: bestTranscript,
        message: 'Language detected successfully'
      });
    } else {
      res.status(200).json({
        language: 'en-US', // Default fallback
        confidence: 0,
        transcript: '',
        message: 'Could not detect language reliably - defaulting to English. Try speaking more clearly or for a longer duration.'
      });
    }
  } catch (error) {
    console.error('Audio language detection error:', error.response?.data || error.message);

    if (error.response) {
      res.status(error.response.status).json({
        error: 'Language detection failed',
        details: error.response.data,
        status: error.response.status
      });
    } else if (error.request) {
      res.status(500).json({
        error: 'Network error - unable to reach Google Speech API for language detection',
        details: error.message
      });
    } else {
      res.status(500).json({
        error: 'Language detection failed',
        details: error.message
      });
    }
  }
});

export default router;