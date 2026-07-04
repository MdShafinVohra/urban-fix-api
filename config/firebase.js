// config/firebase.js
import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import 'dotenv/config'; // This is the ES6 shortcut to load dotenv

try {
    // Ensure the environment variable exists before parsing
    if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
        throw new Error('Missing FIREBASE_SERVICE_ACCOUNT environment variable.');
    }

    // Parse the stringified JSON from your .env file
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

    // Initialize the Admin SDK with the explicit credentials
    initializeApp({
        credential: cert(serviceAccount)
    });

    console.log('Firebase Admin SDK initialized successfully.');
} catch (error) {
    console.error('Firebase Admin initialization error:', error.message);
}

// Export the auth instance to be used by your middleware
export const adminAuth = getAuth();