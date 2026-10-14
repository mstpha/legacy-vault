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
import NotificationBell from "../components/NotificationBell";
import BiometricGate from "../components/BiometricGate";

const Stack = createNativeStackNavigator();

export default function AppNavigator() {
  return (
    // The gate draws the fingerprint / face / PIN lock on top of the whole signed-in app.
    <BiometricGate>
      <Stack.Navigator>
        <Stack.Screen
          name="Home"
          component={HomeScreen}
          options={({ navigation }) => ({
            title: "Digital Legacy Vault",
            headerRight: () => <NotificationBell navigation={navigation} />,
          })}
        />
        <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ title: "Notifications" }} />
        <Stack.Screen name="MfaSetup" component={MfaSetupScreen} options={{ title: "Enable two-factor auth" }} />
        <Stack.Screen name="MfaDisable" component={MfaDisableScreen} options={{ title: "Disable two-factor auth" }} />
        <Stack.Screen name="SecuritySettings" component={SecuritySettingsScreen} options={{ title: "Device security" }} />
        <Stack.Screen name="CapsuleList" component={CapsuleListScreen} options={{ title: "My capsules" }} />
        <Stack.Screen name="CapsuleCreate" component={CapsuleCreateScreen} options={{ title: "New capsule" }} />
        <Stack.Screen name="CapsuleDetail" component={CapsuleDetailScreen} options={{ title: "Capsule" }} />
        <Stack.Screen name="SharedCapsule" component={SharedCapsuleScreen} options={{ title: "Capsule" }} />
        <Stack.Screen
          name="GuarantorPortal"
          component={PortalScreen}
          initialParams={{ role: "guarantor" }}
          options={{ title: "Guarantor portal" }}
        />
        <Stack.Screen
          name="BeneficiaryPortal"
          component={PortalScreen}
          initialParams={{ role: "beneficiary" }}
          options={{ title: "Beneficiary portal" }}
        />
        <Stack.Screen name="AuditLog" component={AuditLogScreen} options={{ title: "Audit log" }} />
        <Stack.Screen name="Permissions" component={PermissionsScreen} options={{ title: "Roles & Permissions" }} />
      </Stack.Navigator>
    </BiometricGate>
  );
}
