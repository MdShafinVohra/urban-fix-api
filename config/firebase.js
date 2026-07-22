// config/firebase.js
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

export function getAdminAuth() {
    // Only initialize if no apps exist yet
    if (getApps().length === 0) {
        try {
            if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
                throw new Error('Missing FIREBASE_SERVICE_ACCOUNT environment variable.');
            }

            const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

            initializeApp({
                credential: cert(serviceAccount)
            });

            console.log('Firebase Admin SDK initialized successfully.');
        } catch (error) {
            console.error('Firebase Admin initialization error:', error.message);
            throw error; // Re-throw so your middleware knows it failed
        }
    }

    // Return the auth instance
    return getAuth();
}