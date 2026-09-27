import { Platform } from "react-native";


const LOCAL_HOST = Platform.OS === "android" ? "192.168.1.116" : "localhost";

export const API_BASE_URL = `http://${LOCAL_HOST}:4000/api`;
