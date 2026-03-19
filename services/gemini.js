// Gemini API Service for DeadlineSnap
import { logger } from '../utils/logger.js';
import { logPerformance } from '../utils/debugger.js';

const GEMINI_API_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'

/**
 * Extract deadline information from image using Gemini API
 * @param {string} base64Image - Base64 encoded image data
 * @param {string} apiKey - User's Gemini API key
 * @returns {Promise<Object>} Extracted task data
 */
export async function extractDeadlineFromImage(base64Image, apiKey) {
    const startTime = performance.now();
    try {
        // Remove data URL prefix if present
        const imageData = base64Image.includes('base64,')
            ? base64Image.split('base64,')[1]
            : base64Image

        // Create prompt for Gemini
        const prompt = `Analyze this screenshot of an opportunity (internship, scholarship, event, application, etc).

Extract the following information:
1. Title: The main title or heading of the opportunity
2. Deadline: The application/submission/registration deadline in YYYY-MM-DD format
3. Category: One of: scholarship, internship, event, course, application, or other
4. Confidence: Your confidence level in the deadline detection: high, medium, or low
5. Notes: Brief summary including eligibility, requirements, location, or other key details (max 150 words)

IMPORTANT RULES:
- If multiple dates exist, identify the APPLICATION/SUBMISSION deadline, NOT start dates or result dates
- Look for keywords: "deadline", "apply by", "last date", "submit before", "registration closes"
- Dates like "posted on" or "results on" are NOT deadlines
- If no clear deadline found, return confidence as "none"

Return ONLY valid JSON in this exact format:
{
  "title": "string",
  "deadline": "YYYY-MM-DD",
  "category": "string",
  "confidence": "high|medium|low|none",
  "notes": "string"
}

Do not include any explanation or markdown formatting. Return only the JSON object.`

        // Make API request
        const response = await fetch(`${GEMINI_API_ENDPOINT}?key=${apiKey}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                contents: [
                    {
                        parts: [
                            {
                                text: prompt
                            },
                            {
                                inline_data: {
                                    mime_type: 'image/png',
                                    data: imageData
                                }
                            }
                        ]
                    }
                ],
                generationConfig: {
                    temperature: 0.1, // Low temperature for consistent output
                    maxOutputTokens: 1000
                }
            })
        })

        if (!response.ok) {
            const errorData = await response.json()
            throw new Error(errorData.error?.message || 'Gemini API request failed')
        }

        const data = await response.json()

        // Extract text from response
        const generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text

        if (!generatedText) {
            throw new Error('No response from Gemini API')
        }

        // Parse JSON from response
        const cleanedText = generatedText.trim()
            .replace(/```json/g, '')
            .replace(/```/g, '')
            .trim()

        const parsedData = JSON.parse(cleanedText)

        // Validate response
        if (!parsedData.title || !parsedData.deadline || !parsedData.category) {
            throw new Error('Invalid response format from Gemini')
        }

        // Check if no deadline found
        if (parsedData.confidence === 'none') {
            return {
                success: false,
                error: 'No clear deadline detected in image. Please add manually.',
                data: parsedData
            }
        }

        const endTime = performance.now();
        logPerformance('Gemini_extractDeadlineFromImage', Math.round(endTime - startTime), {
            success: true,
            confidence: parsedData.confidence
        });

        logger.info('Gemini API extraction successful', { title: parsedData.title, deadline: parsedData.deadline });

        return {
            success: true,
            data: {
                title: parsedData.title.substring(0, 200), // Limit title length
                deadline: parsedData.deadline,
                category: parsedData.category.toLowerCase(),
                confidence: parsedData.confidence.toLowerCase(),
                notes: parsedData.notes?.substring(0, 500) || '', // Limit notes length
                extractedText: generatedText // Store full response
            }
        }
    } catch (error) {
        const endTime = performance.now();
        logPerformance('Gemini_extractDeadlineFromImage', Math.round(endTime - startTime), { success: false, error: error.message });
        logger.error('Gemini API error during extraction', error);

        // Check for specific error types
        if (error.message.includes('API key')) {
            return {
                success: false,
                error: 'Invalid API key. Please check your Gemini API key in settings.'
            }
        }

        if (error.message.includes('quota')) {
            return {
                success: false,
                error: 'API quota exceeded. Please try again later or upgrade your plan.'
            }
        }

        return {
            success: false,
            error: error.message || 'Failed to extract deadline. Please try again.'
        }
    }
}

/**
 * Test API key validity
 * @param {string} apiKey - Gemini API key to test
 * @returns {Promise<boolean>} True if key is valid
 */
export async function testApiKey(apiKey) {
    const startTime = performance.now();
    try {
        const response = await fetch(`${GEMINI_API_ENDPOINT}?key=${apiKey}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                contents: [
                    {
                        parts: [
                            {
                                text: 'Hello, this is a test. Reply with just "OK".'
                            }
                        ]
                    }
                ]
            })
        })

        const success = response.ok;
        const endTime = performance.now();
        logPerformance('Gemini_testApiKey', Math.round(endTime - startTime), { success });
        logger.debug('API Key test complete', { success });

        return success;
    } catch (error) {
        const endTime = performance.now();
        logPerformance('Gemini_testApiKey', Math.round(endTime - startTime), { success: false, error: error.message });
        logger.error('API key test error:', error)
        return false
    }
}
