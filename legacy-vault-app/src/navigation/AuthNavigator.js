import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import LoginScreen from "../screens/LoginScreen";
import RegisterScreen from "../screens/RegisterScreen";
import MfaVerifyScreen from "../screens/MfaVerifyScreen";
import VerifyEmailScreen from "../screens/VerifyEmailScreen";
import { colors } from "../theme";
const Stack = createNativeStackNavigator();

// Every auth screen draws its own dark brand panel (and back button), so no native header.
export default function AuthNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.ink }, animation: "slide_from_right" }}
    >
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="Register" component={RegisterScreen} />
      <Stack.Screen name="VerifyEmail" component={VerifyEmailScreen} />
      <Stack.Screen name="MfaVerify" component={MfaVerifyScreen} />
    </Stack.Navigator>
  );
}
