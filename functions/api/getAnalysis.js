// This is the Cloudflare "Pages Function" handler.
// It must be at the path: /functions/api/getAnalysis.js

export async function onRequestPost(context) {
    try {
        // --- 1. Get data from the user's request ---
        const requestData = await context.request.json();
        const { resumeText, type, location, datePosted } = requestData;

        // --- 2. Get the secret API key from Cloudflare's settings ---
        // This is the variable you add in the Cloudflare dashboard.
        const GEMINI_API_KEY = context.env.GEMINI_API_KEY;
        
        if (!GEMINI_API_KEY) {
            throw new Error("API key is not configured.");
        }
        
        const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${GEMINI_API_KEY}`;

        // --- 3. Build the AI's instructions (System Prompt) ---
        let systemPrompt;
        let tools = [];

        switch (type) {
            case 'jobs':
                systemPrompt = `
                    You are an expert AI job search assistant.
                    1.  Analyze the provided resume (text provided by the user).
                    2.  Use the Google Search tool to find relevant, recent job postings.
                    3.  **FILTER** your search based on these user-provided filters:
                        - Location: "${location || 'any'}"
                        - Date Posted: "${datePosted || 'any'}"
                    4.  Return a list of around 20 of the **most relevant** job postings.
                    5.  **CRITICAL:** You MUST format each posting as a Markdown link: [Job Title - Company](ORIGINAL_JOB_POSTING_URL). Do not return links to Google search results.
                    6.  After the job list, create a section named "## Networking Contacts" and find 3-5 relevant networking contacts (Recruiters, Hiring Managers) at those companies.
                    7.  Format contacts as: [Full Name - Title at Company](LinkedIn_URL or Company_Profile_URL).
                    8.  If no jobs or contacts are found, state that clearly. Do not invent results.
                `;
                // Enable Google Search for this case
                tools = [{ "google_search": {} }];
                break;

            case 'critique':
                systemPrompt = `
                    You are an expert resume reviewer.
                    1.  Analyze the provided resume (text provided by the user).
                    2.  Provide a concise, constructive critique.
                    3.  Structure your critique with a "## Resume Critique" header.
                    4.  Include sections for "Strengths" and "Areas for Improvement".
                    5.  Use bullet points for clear, actionable advice.
                    6.  Do NOT use the Google Search tool. Base your critique only on the text.
                `;
                // No tools (no search) for this case
                break;

            case 'contacts':
                systemPrompt = `
                    You are an expert networking assistant.
                    1.  Analyze the provided resume to understand the user's industry and key roles (text provided by the user).
                    2.  Use the Google Search tool to find 5-10 relevant networking contacts (Recruiters, Hiring Managers, industry leaders) based on that resume.
                    3.  **FILTER** your search based on the user-provided location: "${location || 'any'}".
                    4.  Return a list with a "## Networking Contacts" header.
                    5.  **CRITICAL:** You MUST format each contact as: [Full Name - Title at Company](LinkedIn_URL or Company_Profile_URL).
                    6.  Do not return links to Google search results.
                `;
                // Enable Google Search for this case
                tools = [{ "google_search": {} }];
                break;
            
            default:
                throw new Error("Invalid analysis type.");
        }

        // --- 4. Build the final request to send to Gemini ---
        const payload = {
            contents: [
                {
                    role: "user",
                    parts: [{ text: `Here is my resume:\n\n${resumeText}` }]
                }
            ],
            systemInstruction: {
                parts: [{ text: systemPrompt }]
            },
            tools: tools
        };

        // --- 5. Call the Gemini API ---
        const geminiResponse = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!geminiResponse.ok) {
            const errorBody = await geminiResponse.json();
            console.error("Gemini API Error:", errorBody);
            throw new Error(errorBody.error?.message || "Failed to call Gemini API.");
        }

        const geminiResult = await geminiResponse.json();
        
        // --- 6. Extract the text and sources ---
        const candidate = geminiResult.candidates?.[0];
        const text = candidate?.content?.parts?.[0]?.text || "No response text found.";
        
        let sources = [];
        const groundingMetadata = candidate?.groundingMetadata;
        if (groundingMetadata && groundingMetadata.groundingAttributions) {
            sources = groundingMetadata.groundingAttributions
                .map(attribution => ({
                    uri: attribution.web?.uri,
                    title: attribution.web?.title,
                }))
                .filter(source => source.uri && source.title); // Ensure sources are valid
        }

        // --- 7. Send the final, successful response back to the user ---
        const responsePayload = { text, sources };
        
        return new Response(JSON.stringify(responsePayload), {
            headers: { 'Content-Type': 'application/json' },
            status: 200
        });

    } catch (error) {
        // --- 8. Handle any errors ---
        console.error("Error in Cloudflare function:", error);
        return new Response(JSON.stringify({ error: error.message }), {
            headers: { 'Content-Type': 'application/json' },
            status: 500
        });
    }
}
