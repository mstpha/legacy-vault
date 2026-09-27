import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import HomeScreen from "../screens/HomeScreen";
import MfaSetupScreen from "../screens/MfaSetupScreen";
import MfaDisableScreen from "../screens/MfaDisableScreen";

const Stack = createNativeStackNavigator();

export default function AppNavigator() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="Home" component={HomeScreen} options={{ title: "Digital Legacy Vault" }} />
      <Stack.Screen name="MfaSetup" component={MfaSetupScreen} options={{ title: "Enable two-factor auth" }} />
      <Stack.Screen name="MfaDisable" component={MfaDisableScreen} options={{ title: "Disable two-factor auth" }} />
    </Stack.Navigator>
  );
}