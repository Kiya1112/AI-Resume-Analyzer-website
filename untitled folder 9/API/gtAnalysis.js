import {
    GoogleGenerativeAI,
    HarmCategory,
    HarmBlockThreshold,
} from "@google/generative-ai";

// --- CONFIGURATION ---
const MODEL_NAME = "gemini-2.5-flash-preview-09-2025";
// Get your API key from Vercel's Environment Variables
const API_KEY = process.env.GEMINI_API_KEY;

// --- MAIN HANDLER FUNCTION (VERCEL FORMAT) ---
export default async function handler(request, response) {
    // 1. Check for API Key
    if (!API_KEY) {
        return response.status(500).json({
            error: "API key is missing. Please add GEMINI_API_KEY to your Vercel Environment Variables.",
        });
    }

    // 2. Check that it's a POST request
    if (request.method !== 'POST') {
        return response.status(405).json({ error: 'Method Not Allowed (must be POST)' });
    }

    // 3. Get data from the request body
    const { resumeText, type, location, datePosted } = request.body;

    if (!resumeText) {
        return response.status(400).json({ error: "Resume text is required." });
    }
    if (!type) {
        return response.status(400).json({ error: "Analysis type is required." });
    }

    try {
        const genAI = new GoogleGenerativeAI(API_KEY);
        const model = genAI.getGenerativeModel({
            model: MODEL_NAME,
            // We define the system prompt based on the 'type'
            systemInstruction: getSystemPrompt(type, location, datePosted),
        });

        const generationConfig = {
            temperature: 0.7,
            topK: 64,
            topP: 0.95,
            maxOutputTokens: 8192,
        };

        const safetySettings = [
            { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
            { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
            { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
            { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        ];

        // This is the prompt the user sends (their resume)
        const parts = [
            { text: resumeText },
        ];
        
        // This is the tool that lets the AI search Google
        const tools = [{ "google_search": {} }];

        // 4. Call the AI Model
        const result = await model.generateContent({
            contents: [{ role: "user", parts }],
            generationConfig,
            safetySettings,
            tools: (type === 'jobs' || type === 'contacts') ? tools : undefined, // Only use Google Search for jobs/contacts
        });

        // 5. Process and Send the Response
        const text = result.response.candidates[0].content.parts[0].text;
        
        let sources = [];
        const groundingMetadata = result.response.candidates[0].groundingMetadata;
        
        if (groundingMetadata && groundingMetadata.groundingAttributions) {
            sources = groundingMetadata.groundingAttributions
                .map(attribution => ({
                    uri: attribution.web?.uri,
                    title: attribution.web?.title,
                }))
                .filter(source => source.uri && source.title); // Ensure sources are valid
        }

        // Send the successful response back to the frontend
        return response.status(200).json({
            text: text,
            sources: sources
        });

    } catch (error) {
        console.error("Error in Vercel function:", error);
        return response.status(500).json({
            error: `Error generating content: ${error.message}`,
        });
    }
}


// --- HELPER FUNCTION ---
// This function creates the correct prompt for the AI
function getSystemPrompt(type, location, datePosted) {
    
    // Build the filter string if filters are provided
    let filterString = "";
    if (location) {
        filterString += ` (Location: ${location})`;
    }
    if (datePosted && datePosted !== "any") {
        filterString += ` (Posted: ${datePosted.replace("_", " ")})`;
    }
    if (filterString) {
        filterString = `\n\n**CRITICAL: You MUST adhere to these filters: ${filterString}**`;
    }

    // Select the prompt based on the type
    switch (type) {
        case 'jobs':
            return `You are an expert AI job assistant. Your user has provided their resume.
1.  First, you **MUST** use the Google Search tool to find around 20 relevant job postings based on the user's resume.
2.  You **MUST** format the job title as a markdown link pointing **directly to the original job posting URL (e.g., Greenhouse, Lever, or the company's career page)**, NOT a link to a Google search.
3.  **DO NOT** return links to job boards like LinkedIn, Indeed, or ZipRecruiter. Only return direct, original application links.
4.  After the jobs, provide a new section titled "## Networking Contacts" and find 3-5 relevant networking contacts (like recruiters, hiring managers, or team leads) at those companies.
5.  Format the output clearly using Markdown (headers, bold text, and bullet points).
${filterString}`;
            
        case 'critique':
            return `You are an expert resume critique assistant. Your user has provided their resume.
1.  Provide a concise, professional, and constructive critique of the resume.
2.  Give actionable advice on how to improve it, focusing on clarity, impact, and keywords.
3.  Use bullet points to make the advice easy to read.
4.  Do not use Google Search for this task.`;
            
        case 'contacts':
            return `You are an expert AI networking assistant. Your user has provided their resume.
1.  You **MUST** use the Google Search tool.
2.  Find 5-10 relevant networking contacts (recruiters, hiring managers, team leads) at companies that would likely hire someone with this resume.
3.  Provide their name, title, company, and if possible, a link to their public profile (like LinkedIn or a company bio).
4.  Format the output clearly using Markdown.
${filterString}`;
            
        default:
            return `You are a helpful assistant. Please analyze the provided text.`;
    }
}

