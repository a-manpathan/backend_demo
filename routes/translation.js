import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const router = express.Router();

// Get API key from environment variables
const GOOGLE_TRANSLATION_API_KEY = process.env.GOOGLE_TRANSLATION_API_KEY;

// Language code mapping for Google Translate API
const languageCodeMap = {
  'en-US': 'en',
  'hi-IN': 'hi',
  'es-ES': 'es',
  'fr-FR': 'fr',
  'de-DE': 'de',
  'ja-JP': 'ja',
  'zh-CN': 'zh'
};

router.post('/translate', async (req, res) => {
  try {
    const { text, targetLanguage, sourceLanguage = 'auto' } = req.body;
    
    if (!text) {
      return res.status(400).json({ error: 'Text is required for translation' });
    }

    if (!targetLanguage) {
      return res.status(400).json({ error: 'Target language is required' });
    }

    if (!GOOGLE_TRANSLATION_API_KEY) {
      return res.status(500).json({ error: 'Google Translation API key not configured' });
    }

    // Convert speech recognition language codes to Google Translate language codes
    const targetLang = languageCodeMap[targetLanguage] || targetLanguage.split('-')[0];
    const sourceLang = sourceLanguage === 'auto' ? undefined : (languageCodeMap[sourceLanguage] || sourceLanguage.split('-')[0]);

    console.log('Translation request:', {
      text: text.substring(0, 100) + '...',
      sourceLang,
      targetLang
    });

    // If source and target languages are the same, return original text
    if (sourceLang === targetLang && sourceLang !== 'auto') {
      return res.json({
        translatedText: text,
        detectedSourceLanguage: sourceLang,
        targetLanguage: targetLang
      });
    }

    // Call Google Translate API
    const requestBody = {
      q: text,
      target: targetLang,
      format: 'text'
    };

    // Only add source if it's not auto-detect
    if (sourceLang && sourceLang !== 'auto') {
      requestBody.source = sourceLang;
    }

    const response = await axios.post(
      `https://translation.googleapis.com/language/translate/v2?key=${GOOGLE_TRANSLATION_API_KEY}`,
      requestBody,
      {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      }
    );

    if (response.data && response.data.data && response.data.data.translations) {
      const translation = response.data.data.translations[0];
      
      console.log('Translation successful');
      
      res.json({
        translatedText: translation.translatedText,
        detectedSourceLanguage: translation.detectedSourceLanguage || sourceLang,
        targetLanguage: targetLang
      });
    } else {
      throw new Error('Invalid response from Google Translate API');
    }

  } catch (error) {
    console.error('Translation error:', error.response?.data || error.message);
    
    if (error.response) {
      res.status(error.response.status).json({ 
        error: 'Translation failed', 
        details: error.response.data,
        status: error.response.status
      });
    } else if (error.request) {
      res.status(500).json({ 
        error: 'Network error - unable to reach Google Translate API', 
        details: error.message 
      });
    } else {
      res.status(500).json({ 
        error: 'Translation failed', 
        details: error.message 
      });
    }
  }
});

// Route to get supported languages
router.get('/languages', async (req, res) => {
  try {
    if (!GOOGLE_TRANSLATION_API_KEY) {
      return res.status(500).json({ error: 'Google Translation API key not configured' });
    }

    const response = await axios.get(
      `https://translation.googleapis.com/language/translate/v2/languages?key=${GOOGLE_TRANSLATION_API_KEY}&target=en`
    );

    res.json(response.data);
  } catch (error) {
    console.error('Error fetching supported languages:', error.response?.data || error.message);
    res.status(500).json({ 
      error: 'Failed to fetch supported languages', 
      details: error.response?.data || error.message 
    });
  }
});

export default router;
