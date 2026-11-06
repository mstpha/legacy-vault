import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import HomeScreen from "../screens/HomeScreen";
import MfaSetupScreen from "../screens/MfaSetupScreen";
import MfaDisableScreen from "../screens/MfaDisableScreen";
import CapsuleListScreen from "../screens/CapsuleListScreen";
import CapsuleCreateScreen from "../screens/CapsuleCreateScreen";
import CapsuleDetailScreen from "../screens/CapsuleDetailScreen";
import SharedCapsuleScreen from "../screens/SharedCapsuleScreen";
import NotificationsScreen from "../screens/NotificationsScreen";
import PortalScreen from "../screens/PortalScreen";
import PermissionsScreen from "../screens/PermissionsScreen";
import SecuritySettingsScreen from "../screens/SecuritySettingsScreen";
import AuditLogScreen from "../screens/AuditLogScreen";
import BiometricGate from "../components/BiometricGate";
import { colors } from "../theme";

const Stack = createNativeStackNavigator();

// Flat, shadowless headers on the same off-white canvas as the screens.
// Screens that open with their own dark hero card keep the header title empty (just a back arrow).
const screenOptions = {
  headerStyle: { backgroundColor: colors.canvas },
  headerShadowVisible: false,
  headerTintColor: colors.ink,
  headerTitleStyle: { fontWeight: "700", fontSize: 17, color: colors.ink },
  headerBackTitleVisible: false,
  headerTitleAlign: "center",
  contentStyle: { backgroundColor: colors.canvas },
  animation: "slide_from_right",
};

export default function AppNavigator() {
  return (
    // The gate draws the fingerprint / face / PIN lock on top of the whole signed-in app.
    <BiometricGate>
      <Stack.Navigator screenOptions={screenOptions}>
        {/* Home draws its own header (greeting + notification bell). */}
        <Stack.Screen name="Home" component={HomeScreen} options={{ headerShown: false }} />
        <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ title: "Notifications" }} />
        <Stack.Screen name="MfaSetup" component={MfaSetupScreen} options={{ title: "Two-factor setup" }} />
        <Stack.Screen name="MfaDisable" component={MfaDisableScreen} options={{ title: "Two-factor" }} />
        <Stack.Screen name="SecuritySettings" component={SecuritySettingsScreen} options={{ title: "" }} />
        <Stack.Screen name="CapsuleList" component={CapsuleListScreen} options={{ title: "" }} />
        <Stack.Screen name="CapsuleCreate" component={CapsuleCreateScreen} options={{ title: "New capsule" }} />
        <Stack.Screen name="CapsuleDetail" component={CapsuleDetailScreen} options={{ title: "" }} />
        <Stack.Screen name="SharedCapsule" component={SharedCapsuleScreen} options={{ title: "" }} />
        <Stack.Screen name="GuarantorPortal" component={PortalScreen} initialParams={{ role: "guarantor" }} options={{ title: "" }} />
        <Stack.Screen name="BeneficiaryPortal" component={PortalScreen} initialParams={{ role: "beneficiary" }} options={{ title: "" }} />
        <Stack.Screen name="AuditLog" component={AuditLogScreen} options={{ title: "" }} />
        <Stack.Screen name="Permissions" component={PermissionsScreen} options={{ title: "" }} />
      </Stack.Navigator>
    </BiometricGate>
  );
}
