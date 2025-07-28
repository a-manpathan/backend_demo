import express from 'express';
import axios from 'axios';
import {io} from './socketSetup.js';
import dotenv from 'dotenv';

dotenv.config();

const router = express.Router();

// Get API key from environment variables
// Make sure your GOOGLE_APPLICATION_CREDENTIALS environment variable is set correctly.
const GOOGLE_API_KEY = process.env.GOOGLE_APPLICATION_CREDENTIALS;

router.post('/transcribe', async (req, res) => {
  try {
    const { audioContent, languageCode = 'en-US', speakerCount = 2 } = req.body;

    if (!audioContent) {
      return res.status(400).json({ error: 'Audio content is required' });
    }
    if (!GOOGLE_API_KEY) {
      return res.status(500).json({ error: 'Google API key not configured' });
    }

    console.log('Received full audio transcription request.');

    // Since the frontend sends a complete WebM file, we prioritize that encoding.
    // LINEAR16 is a good fallback if the initial attempt fails.
    const audioConfigs = [
      { encoding: 'WEBM_OPUS', sampleRateHertz: 48000, description: 'WebM Opus' },
      { encoding: 'LINEAR16', sampleRateHertz: 16000, description: 'Linear16' },
    ];

    let finalResponse;
    let lastError;

    for (const config of audioConfigs) {
      try {
        console.log(`Attempting transcription with ${config.description}...`);
        const requestPayload = {
          config: {
            encoding: config.encoding,
            sampleRateHertz: config.sampleRateHertz,
            languageCode: languageCode,
            enableAutomaticPunctuation: true,
            model: 'latest_long', // Best model for diarization
            diarizationConfig: {
              enableSpeakerDiarization: true,
              minSpeakerCount: 2,
              maxSpeakerCount: Math.max(2, speakerCount),
            },
            useEnhanced: true, // Use enhanced model for better accuracy
          },
          audio: {
            content: audioContent,
          },
        };

        finalResponse = await axios.post(
          `https://speech.googleapis.com/v1/speech:recognize?key=${GOOGLE_API_KEY}`,
          requestPayload,
          { timeout: 120000 } // Increased timeout for longer audio files
        );

        // Check if we got a valid result with words
        if (finalResponse.data.results?.[0]?.alternatives?.[0]?.words) {
          console.log(`Success with ${config.description}.`);
          break; // Exit loop on success
        } else {
          console.log(`Request with ${config.description} succeeded but returned no words. Trying next config.`);
        }
      } catch (error) {
        lastError = error;
        console.error(`Error with ${config.description}:`, error.response?.data?.error?.message || error.message);
        continue;
      }
    }

    if (!finalResponse || !finalResponse.data.results) {
        console.error("Transcription failed after trying all configs.", lastError?.response?.data?.error);
        throw lastError || new Error('Transcription failed after trying all configs.');
    }

    // *** IMPROVED LOGIC TO PROCESS THE FULL TRANSCRIPT WITH PROPER SPEAKER DIARIZATION ***
    const words = finalResponse.data.results.flatMap(result => result.alternatives?.[0]?.words || []);

    if (words.length === 0) {
      console.log('No words found in the final transcript.');
      return res.json({ transcript: [] });
    }

    console.log(`Processing ${words.length} words for speaker diarization`);

    // Group words by speaker segments with improved logic
    const transcriptBySpeaker = [];
    let currentSpeakerTag = null;
    let currentSegment = {
      words: [],
      startTime: null,
      endTime: null
    };

    for (let i = 0; i < words.length; i++) {
      const wordInfo = words[i];
      
      // Handle missing speaker tags by using the previous word's speaker tag
      let speakerTag = wordInfo.speakerTag;
      if (speakerTag === undefined || speakerTag === null) {
        // Look backwards to find the last valid speaker tag
        for (let j = i - 1; j >= 0; j--) {
          if (words[j].speakerTag !== undefined && words[j].speakerTag !== null) {
            speakerTag = words[j].speakerTag;
            break;
          }
        }
        // If still no speaker tag found, default to speaker 1
        if (speakerTag === undefined || speakerTag === null) {
          speakerTag = 1;
        }
      }

      // Convert speaker tag to number for consistency
      speakerTag = parseInt(speakerTag);

      // If this is the first word or speaker changed
      if (currentSpeakerTag === null || speakerTag !== currentSpeakerTag) {
        // Save the previous segment if it exists
        if (currentSpeakerTag !== null && currentSegment.words.length > 0) {
          const transcript = currentSegment.words.map(w => w.word).join(' ').trim();
          if (transcript) {
            transcriptBySpeaker.push({
              speaker: `Speaker ${currentSpeakerTag}`,
              transcript: transcript,
              startTime: currentSegment.startTime,
              endTime: currentSegment.endTime
            });
          }
        }

        // Start a new segment
        currentSpeakerTag = speakerTag;
        currentSegment = {
          words: [wordInfo],
          startTime: wordInfo.startTime || null,
          endTime: wordInfo.endTime || null
        };
      } else {
        // Add word to current segment
        currentSegment.words.push(wordInfo);
        currentSegment.endTime = wordInfo.endTime || currentSegment.endTime;
      }
    }

    // Add the final segment
    if (currentSpeakerTag !== null && currentSegment.words.length > 0) {
      const transcript = currentSegment.words.map(w => w.word).join(' ').trim();
      if (transcript) {
        transcriptBySpeaker.push({
          speaker: `Speaker ${currentSpeakerTag}`,
          transcript: transcript,
          startTime: currentSegment.startTime,
          endTime: currentSegment.endTime
        });
      }
    }

    // Post-process to merge very short segments from the same speaker
    const mergedTranscript = [];
    for (let i = 0; i < transcriptBySpeaker.length; i++) {
      const current = transcriptBySpeaker[i];
      
      // If this segment is very short (less than 3 words) and the next segment is from the same speaker, merge them
      if (i < transcriptBySpeaker.length - 1) {
        const next = transcriptBySpeaker[i + 1];
        const currentWordCount = current.transcript.split(' ').length;
        
        if (currentWordCount < 3 && current.speaker === next.speaker) {
          // Merge current with next
          next.transcript = current.transcript + ' ' + next.transcript;
          next.startTime = current.startTime || next.startTime;
          continue; // Skip adding current segment
        }
      }
      
      mergedTranscript.push({
        speaker: current.speaker,
        transcript: current.transcript
      });
    }

    console.log(`Successfully generated ${mergedTranscript.length} speaker segments`);
    
    // Log the segments for debugging
    mergedTranscript.forEach((segment, index) => {
      console.log(`Segment ${index + 1} - ${segment.speaker}: "${segment.transcript.substring(0, 50)}..."`);
    });

    res.json({ transcript: mergedTranscript });

  } catch (error) {
    console.error('Unhandled Speech-to-text error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Speech recognition failed', details: error.response?.data || error.message });
  }
});

// The /detect-language route remains unchanged.
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
                  sampleRateHertz: config.sampleRateHerz,
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
      transcript: bestTranscript ? bestTranslript.substring(0, 50) + '...' : 'No transcript'
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