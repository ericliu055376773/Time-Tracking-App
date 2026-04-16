import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey:            "AIzaSyDrfYEf3wmheX-f8WTo1w6Wx8AK1Vak7Do",
  authDomain:        "salary-d6674.firebaseapp.com",
  projectId:         "salary-d6674",
  storageBucket:     "salary-d6674.firebasestorage.app",
  messagingSenderId: "549568332543",
  appId:             "1:549568332543:web:2d74db9944f28222c3c2ca",
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db   = getFirestore(app);
export default app;