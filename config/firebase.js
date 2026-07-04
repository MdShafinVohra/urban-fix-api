// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyCSSaRON1uw-vI2yKnkthRkX0RT0laYspI",
    authDomain: "urbanfix-c976f.firebaseapp.com",
    projectId: "urbanfix-c976f",
    storageBucket: "urbanfix-c976f.firebasestorage.app",
    messagingSenderId: "1035690937059",
    appId: "1:1035690937059:web:1a576bb6f36993480f13d6"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

