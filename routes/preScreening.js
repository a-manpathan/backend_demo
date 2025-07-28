import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const router = express.Router();

const AZURE_AI_API_KEY = process.env.AZURE_AI_API_KEY;
const AZURE_AI_ENDPOINT = process.env.AZURE_AI_ENDPOINT || 'https://gendem.cognitiveservices.azure.com/';

// Helper function for making requests to Azure AI with retry logic for rate limiting
const retryRequest = async (url, data, headers, retries = 3, initialDelay = 2000) => {
    try {
        const response = await axios.post(url, data, { headers, timeout: 30000 });
        return response;
    } catch (error) {
        if (error.response && error.response.status === 429 && retries > 0) {
            const retryAfter = error.response.headers['retry-after'] || initialDelay / 1000;
            const delay = retryAfter * 1000;
            console.log(`Rate limit exceeded. Retrying in ${delay / 1000}s (${retries} attempts left)`);
            await new Promise(resolve => setTimeout(resolve, delay));
            return retryRequest(url, data, headers, retries - 1, initialDelay * 2);
        }
        throw error;
    }
};

// --- DYNAMIC AI-POWERED ENDPOINT: Generates the next question ---
router.post('/next-question', async (req, res) => {
    try {
        const { department, conversation } = req.body; // Using full conversation history

        if (!AZURE_AI_API_KEY) {
            return res.status(500).json({ error: 'Azure AI API key not configured' });
        }

        // System prompt to guide the AI model
        const systemPrompt = `You are an AI medical assistant conducting a pre-appointment screening.
        - Your goal is to ask the user a series of 5-6 questions to understand their symptoms.
        - Start by asking for the main reason for the visit, considering the selected department: ${department}.
        - Ask only one question at a time.
        - Keep your questions concise and easy to understand.
        - Based on the user's answers, ask relevant follow-up questions.
        - After 5-6 questions, or when you have enough information, your final message must be "Thank you. You can now confirm your appointment." to signal the end.
        - Do not add any extra phrases or greetings to the final message.`;
        
        // Construct the message history for the AI
        const messages = [{ role: 'system', content: systemPrompt }];
        if (conversation && conversation.length > 0) {
            conversation.forEach(msg => {
                messages.push({ role: msg.role, content: msg.content });
            });
        } else {
            // This is the first question
             messages.push({ role: 'user', content: 'I am ready to start.' });
        }

        const response = await retryRequest(
             `${AZURE_AI_ENDPOINT}/openai/deployments/gpt-4o-mini/chat/completions?api-version=2024-12-01-preview`, {
                messages: messages,
                max_tokens: 100,
                temperature: 0.5,
            }, {
                'Content-Type': 'application/json',
                'api-key': AZURE_AI_API_KEY,
            }
        );

        const nextQuestion = response.data.choices[0].message.content.trim();
        
        // Determine if the conversation is complete
        const isComplete = nextQuestion.startsWith("Thank you. You can now confirm your appointment.");

        res.json({
            question: nextQuestion,
            isComplete: isComplete,
        });

    } catch (error) {
        console.error('Error in /next-question endpoint:', error.response?.data || error.message);
        res.status(500).json({
            error: 'Failed to get the next question from AI',
            details: error.message
        });
    }
});


// --- AI-POWERED ENDPOINT: Generates the final report ---
router.post('/generate-report', async (req, res) => {
    try {
        const { conversation, appointmentDetails } = req.body;

        if (!conversation || conversation.length === 0) {
            return res.status(400).json({ error: 'Conversation log is required' });
        }

        if (!AZURE_AI_API_KEY) {
            return res.status(500).json({ error: 'Azure AI API key not configured' });
        }
        
        const systemPrompt = `You are a medical assistant responsible for summarizing a patient-AI conversation into a structured report for a doctor.

Generate a report with three sections, using markdown for formatting:
1.  **Patient Description**: Briefly state the patient's main complaint in one sentence.
2.  **Key Points**: Create a bulleted list summarizing the critical details from the conversation (e.g., duration of symptoms, pain description, severity, related symptoms).
3.  **Next Steps**: Confirm the appointment details and add a generic reminder for the patient.

Analyze the provided conversation and format the output exactly as requested.`;

        // Reformat conversation for the prompt
        const conversationText = conversation.map(msg => {
            const sender = msg.role === 'user' ? 'Patient' : 'AI Assistant';
            return `${sender}: ${msg.content}`;
        }).join('\n');

        const userPrompt = `Please generate a patient report based on the following conversation:
---
${conversationText}
---

Appointment Details:
Date: ${appointmentDetails.date}
Time: ${appointmentDetails.time}`;

        const response = await retryRequest(
            `${AZURE_AI_ENDPOINT}/openai/deployments/gpt-4o-mini/chat/completions?api-version=2024-12-01-preview`, {
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                max_tokens: 500, // Increased for a more detailed report
                temperature: 0.2,
            }, {
                'Content-Type': 'application/json',
                'api-key': AZURE_AI_API_KEY,
            }
        );

        const report = response.data.choices[0].message.content.trim();
        res.json({ report });

    } catch (error) {
        console.error('Report generation error:', error.response?.data || error.message);
        res.status(500).json({
            error: 'Failed to generate report',
            details: error.message
        });
    }
});


export default router;