/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import { GoogleGenAI, GenerateContentResponse, Modality, Type } from "@google/genai";

const fileToPart = async (file: File) => {
    const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = error => reject(error);
    });
    const { mimeType, data } = dataUrlToParts(dataUrl);
    return { inlineData: { mimeType, data } };
};

const dataUrlToParts = (dataUrl: string) => {
    const arr = dataUrl.split(',');
    if (arr.length < 2) throw new Error("Invalid data URL");
    const mimeMatch = arr[0].match(/:(.*?);/);
    if (!mimeMatch || !mimeMatch[1]) throw new Error("Could not parse MIME type from data URL");
    return { mimeType: mimeMatch[1], data: arr[1] };
}

const dataUrlToPart = (dataUrl: string) => {
    const { mimeType, data } = dataUrlToParts(dataUrl);
    return { inlineData: { mimeType, data } };
}

const handleApiResponse = (response: GenerateContentResponse): string => {
    if (response.promptFeedback?.blockReason) {
        const { blockReason, blockReasonMessage } = response.promptFeedback;
        const errorMessage = `Request was blocked. Reason: ${blockReason}. ${blockReasonMessage || ''}`;
        throw new Error(errorMessage);
    }

    // Find the first image part in any candidate
    for (const candidate of response.candidates ?? []) {
        const imagePart = candidate.content?.parts?.find(part => part.inlineData);
        if (imagePart?.inlineData) {
            const { mimeType, data } = imagePart.inlineData;
            return `data:${mimeType};base64,${data}`;
        }
    }

    const finishReason = response.candidates?.[0]?.finishReason;
    if (finishReason && finishReason !== 'STOP') {
        const errorMessage = `Image generation stopped unexpectedly. Reason: ${finishReason}. This often relates to safety settings.`;
        throw new Error(errorMessage);
    }
    const textFeedback = response.text?.trim();
    const errorMessage = `The AI model did not return an image. ` + (textFeedback ? `The model responded with text: "${textFeedback}"` : "This can happen due to safety filters or if the request is too complex. Please try a different image.");
    throw new Error(errorMessage);
};

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });
const imageModel = 'gemini-2.5-flash-image-preview';
const textModel = 'gemini-2.5-flash';

export const generateModelImage = async (userImage: File): Promise<string> => {
    const userImagePart = await fileToPart(userImage);
    const prompt = "You are an expert fashion photographer AI. Transform the person in this image into a full-body fashion model photo suitable for an e-commerce website. The background must be a clean, neutral studio backdrop (light gray, #f0f0f0). The person should have a neutral, professional model expression. Preserve the person's identity, unique features, and body type, but place them in a standard, relaxed standing model pose. The final image must be photorealistic. Return ONLY the final image.";
    const response = await ai.models.generateContent({
        model: imageModel,
        contents: { parts: [userImagePart, { text: prompt }] },
        config: {
            responseModalities: [Modality.IMAGE, Modality.TEXT],
        },
    });
    return handleApiResponse(response);
};

export const generateVirtualTryOnImage = async (modelImageUrl: string, garmentImage: File): Promise<string> => {
    const modelImagePart = dataUrlToPart(modelImageUrl);
    const garmentImagePart = await fileToPart(garmentImage);
    const prompt = `You are an expert virtual try-on AI. You will be given a 'model image' and a 'garment image'. Your task is to create a new photorealistic image where the person from the 'model image' is wearing the clothing from the 'garment image'.

**Crucial Rules:**
1.  **Complete Garment Replacement:** You MUST completely REMOVE and REPLACE the clothing item worn by the person in the 'model image' with the new garment. No part of the original clothing (e.g., collars, sleeves, patterns) should be visible in the final image.
2.  **Preserve the Model:** The person's face, hair, body shape, and pose from the 'model image' MUST remain unchanged.
3.  **Preserve the Background:** The entire background from the 'model image' MUST be preserved perfectly.
4.  **Apply the Garment:** Realistically fit the new garment onto the person. It should adapt to their pose with natural folds, shadows, and lighting consistent with the original scene.
5.  **Output:** Return ONLY the final, edited image. Do not include any text.`;
    const response = await ai.models.generateContent({
        model: imageModel,
        contents: { parts: [modelImagePart, garmentImagePart, { text: prompt }] },
        config: {
            responseModalities: [Modality.IMAGE, Modality.TEXT],
        },
    });
    return handleApiResponse(response);
};

export const generatePoseVariation = async (tryOnImageUrl: string, poseInstruction: string): Promise<string> => {
    const tryOnImagePart = dataUrlToPart(tryOnImageUrl);
    const prompt = `You are an expert fashion photographer AI. Take this image and regenerate it from a different perspective. The person, clothing, and background style must remain identical. The new perspective should be: "${poseInstruction}". Return ONLY the final image.`;
    const response = await ai.models.generateContent({
        model: imageModel,
        contents: { parts: [tryOnImagePart, { text: prompt }] },
        config: {
            responseModalities: [Modality.IMAGE, Modality.TEXT],
        },
    });
    return handleApiResponse(response);
};

export const getHarmonicColors = async (garmentImage: File): Promise<string[]> => {
    const garmentImagePart = await fileToPart(garmentImage);
    const prompt = "Analyze the main color of the clothing item in this image. Based on that color, generate an array of 4 complementary and aesthetically pleasing harmonic color hex codes. The background of the garment is transparent, so ignore it. Focus only on the garment itself. Return ONLY a valid JSON object.";

    const response = await ai.models.generateContent({
        model: textModel,
        contents: { parts: [garmentImagePart, { text: prompt }] },
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    colors: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING }
                    }
                }
            }
        }
    });

    try {
        const jsonString = response.text.trim();
        const result = JSON.parse(jsonString);
        if (result.colors && Array.isArray(result.colors) && result.colors.length > 0) {
            return result.colors;
        }
        throw new Error("Invalid JSON structure in response.");
    } catch (e) {
        console.error("Failed to parse harmonic colors JSON:", e);
        // Fallback colors if generation fails
        return ['#A0D2DB', '#7A6E9E', '#E8A0BF', '#B4E1D2'];
    }
};

export const recolorGarment = async (garmentImage: File, colorHex: string): Promise<string> => {
    const garmentImagePart = await fileToPart(garmentImage);
    const prompt = `Recolor the garment in this image to the hex code ${colorHex}. The garment has a transparent background which you must preserve. Maintain the original texture, shadows, and details of the garment perfectly. Only change the color. Return ONLY the final image.`;

    const response = await ai.models.generateContent({
        model: imageModel,
        contents: { parts: [garmentImagePart, { text: prompt }] },
        config: {
            responseModalities: [Modality.IMAGE, Modality.TEXT],
        },
    });

    return handleApiResponse(response);
};
