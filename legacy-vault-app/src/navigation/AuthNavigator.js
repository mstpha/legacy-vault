import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import LoginScreen from "../screens/LoginScreen";
import RegisterScreen from "../screens/RegisterScreen";
import MfaVerifyScreen from "../screens/MfaVerifyScreen";
import VerifyEmailScreen from "../screens/VerifyEmailScreen";
const Stack = createNativeStackNavigator();

export default function AuthNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="Register" component={RegisterScreen} />
      <Stack.Screen name="VerifyEmail" component={VerifyEmailScreen} />
      <Stack.Screen name="MfaVerify" component={MfaVerifyScreen} options={{ headerShown: true, title: "Verify code" }} />
    </Stack.Navigator>
  );
}
