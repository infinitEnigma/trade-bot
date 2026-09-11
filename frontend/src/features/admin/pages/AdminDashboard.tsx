/** @format */

import React, { useState } from "react";
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard,
  Shield,
  Settings,
  AlertTriangle,
  CheckCircle,
  Server,
  Database,
  Cpu,
  MemoryStick,
  HardDrive,
  Users as UsersIcon,
  Bot,
  Zap
} from "lucide-react";
import { systemApi } from "../../../infrastructure/api/system";
import { Card } from "../../../shared/components/ui/Card";
import { SectionHeader } from "../../../shared/components/ui/SectionHeader";
import { Container, Grid, Section } from "../../../shared/components/layout";
import LoadingSpinner from "../../../shared/components/ui/LoadingSpinner";

// Admin Dashboard Component
const AdminDashboard: React.FC = () => {
  const [activeTab, setActiveTab] = useState("overview");

  // Fetch system health data
  const { data: healthData, isLoading: healthLoading } = useQuery({
    queryKey: ["system-health"],
    queryFn: systemApi.getSystemHealth,
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Fetch performance metrics
  const { data: metricsData, isLoading: metricsLoading } = useQuery({
    queryKey: ["system-metrics"],
    queryFn: systemApi.getSystemMetrics,
    refetchInterval: 60000, // Refresh every minute
  });

  // Fetch service status
  const { data: servicesData, isLoading: servicesLoading } = useQuery({
    queryKey: ["system-services"],
    queryFn: systemApi.getServiceStatus,
    refetchInterval: 60000, // Refresh every minute
  });

  const tabs = [
    { id: "overview", label: "Overview", icon: <LayoutDashboard className="w-4 h-4" /> },
    { id: "users", label: "Users", icon: <UsersIcon className="w-4 h-4" /> },
    { id: "system", label: "System", icon: <Server className="w-4 h-4" /> },
    { id: "security", label: "Security", icon: <Shield className="w-4 h-4" /> },
    { id: "bots", label: "Bots", icon: <Bot className="w-4 h-4" /> },
    { id: "settings", label: "Settings", icon: <Settings className="w-4 h-4" /> },
  ];

  const renderStatusIndicator = (status: string) => {
    const statusMap = {
      HEALTHY: <CheckCircle className="w-4 h-4 text-green-500" />,
      DEGRADED: <AlertTriangle className="w-4 h-4 text-yellow-500" />,
      UNHEALTHY: <AlertTriangle className="w-4 h-4 text-red-500" />,
      ACTIVE: <CheckCircle className="w-4 h-4 text-green-500" />,
      INACTIVE: <AlertTriangle className="w-4 h-4 text-yellow-500" />,
      ERROR: <AlertTriangle className="w-4 h-4 text-red-500" />,
    };

    return statusMap[status as keyof typeof statusMap] || <AlertTriangle className="w-4 h-4 text-gray-500" />;
  };

  return (
    <Container
      size={{
        default: 'lg',
        xl: 'xl',
        '2xl': '2xl',
        '3xl': '3xl',
        '4xl': '4xl'
      }}
      className="py-2 space-y-4"
    >
      <Section>
        {/* Dashboard Header */}
        <div className="mb-8">
          <SectionHeader
            title="Admin Dashboard"
            subtitle="System monitoring and management"
            actions={
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-linear-to-r from-primary to-accent text-white">
                  <Zap className="w-4 h-4" />
                  <span className="text-sm font-medium">SYSTEM_ADMIN</span>
                </div>
              </div>
            }
          />
        </div>

        {/* Navigation Tabs */}
        <div className="mb-8">
          <nav className="flex items-center gap-2 p-1 bg-white/5 rounded-lg">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`
                  flex items-center gap-2 px-4 py-2 rounded-md transition-all
                  ${activeTab === tab.id
                    ? "bg-primary/20 text-primary border border-primary/30"
                    : "text-text-secondary hover:text-text-primary hover:bg-white/5"
                  }
                `}
              >
                {tab.icon}
                <span className="text-sm font-medium">{tab.label}</span>
              </button>
            ))}
          </nav>
        </div>

        {/* Dashboard Content */}
        {activeTab === "overview" && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
          >
            {/* System Health Cards */}
            <div className="mb-8">
              <SectionHeader title="System Health" subtitle="Real-time system status" />
              
              {healthLoading ? (
                <Grid cols={{ default: 1, md: 2, lg: 4 }} gap={6}>
                  {[1, 2, 3, 4].map(i => (
                    <Card key={i} className="p-6 flex items-center justify-center">
                      <LoadingSpinner />
                    </Card>
                  ))}
                </Grid>
              ) : healthData ? (
                <Grid cols={{ default: 1, md: 2, lg: 4 }} gap={6}>
                  <Card className="p-6">
                    <div className="flex items-center justify-between mb-4">
                      <div className="w-10 h-10 bg-blue-500/10 rounded-lg flex items-center justify-center">
                        <Server className="w-5 h-5 text-blue-500" />
                      </div>
                      {renderStatusIndicator(healthData.services.api)}
                    </div>
                    <h3 className="text-lg font-bold text-text mb-1">API Service</h3>
                    <p className="text-xs text-textMuted capitalize">{healthData.services.api}</p>
                  </Card>

                  <Card className="p-6">
                    <div className="flex items-center justify-between mb-4">
                      <div className="w-10 h-10 bg-green-500/10 rounded-lg flex items-center justify-center">
                        <Database className="w-5 h-5 text-green-500" />
                      </div>
                      {renderStatusIndicator(healthData.services.database)}
                    </div>
                    <h3 className="text-lg font-bold text-text mb-1">Database</h3>
                    <p className="text-xs text-textMuted capitalize">{healthData.services.database}</p>
                  </Card>

                  <Card className="p-6">
                    <div className="flex items-center justify-between mb-4">
                      <div className="w-10 h-10 bg-purple-500/10 rounded-lg flex items-center justify-center">
                        <Cpu className="w-5 h-5 text-purple-500" />
                      </div>
                      {renderStatusIndicator(healthData.services.engine)}
                    </div>
                    <h3 className="text-lg font-bold text-text mb-1">Engine</h3>
                    <p className="text-xs text-textMuted capitalize">{healthData.services.engine}</p>
                  </Card>

                  <Card className="p-6">
                    <div className="flex items-center justify-between mb-4">
                      <div className="w-10 h-10 bg-yellow-500/10 rounded-lg flex items-center justify-center">
                        <MemoryStick className="w-5 h-5 text-yellow-500" />
                      </div>
                      {renderStatusIndicator(healthData.services.redis)}
                    </div>
                    <h3 className="text-lg font-bold text-text mb-1">Redis</h3>
                    <p className="text-xs text-textMuted capitalize">{healthData.services.redis}</p>
                  </Card>
                </Grid>
              ) : (
                <Card className="text-center py-8">
                  <AlertTriangle className="w-12 h-12 text-yellow-500 mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-text mb-2">
                    System Health Unavailable
                  </h3>
                  <p className="text-textMuted">
                    Unable to fetch system health data at this time
                  </p>
                </Card>
              )}
            </div>

            {/* Performance Metrics */}
            <div className="mb-8">
              <SectionHeader title="Performance Metrics" subtitle="System resource utilization" />
              
              {metricsLoading ? (
                <Grid cols={{ default: 1, md: 2, lg: 3 }} gap={6}>
                  {[1, 2, 3].map(i => (
                    <Card key={i} className="p-6 flex items-center justify-center">
                      <LoadingSpinner />
                    </Card>
                  ))}
                </Grid>
              ) : metricsData ? (
                <Grid cols={{ default: 1, md: 2, lg: 3 }} gap={6}>
                  <Card className="p-6">
                    <div className="flex items-center justify-between mb-4">
                      <div className="w-10 h-10 bg-red-500/10 rounded-lg flex items-center justify-center">
                        <Cpu className="w-5 h-5 text-red-500" />
                      </div>
                    </div>
                    <h3 className="text-lg font-bold text-text mb-1">CPU Usage</h3>
                    <p className="text-xs text-textMuted">{metricsData.cpu}%</p>
                  </Card>

                  <Card className="p-6">
                    <div className="flex items-center justify-between mb-4">
                      <div className="w-10 h-10 bg-green-500/10 rounded-lg flex items-center justify-center">
                        <MemoryStick className="w-5 h-5 text-green-500" />
                      </div>
                    </div>
                    <h3 className="text-lg font-bold text-text mb-1">Memory Usage</h3>
                    <p className="text-xs text-textMuted">{metricsData.memory}%</p>
                  </Card>

                  <Card className="p-6">
                    <div className="flex items-center justify-between mb-4">
                      <div className="w-10 h-10 bg-blue-500/10 rounded-lg flex items-center justify-center">
                        <HardDrive className="w-5 h-5 text-blue-500" />
                      </div>
                    </div>
                    <h3 className="text-lg font-bold text-text mb-1">Disk Usage</h3>
                    <p className="text-xs text-textMuted">{metricsData.disk}%</p>
                  </Card>
                </Grid>
              ) : (
                <Card className="text-center py-8">
                  <AlertTriangle className="w-12 h-12 text-yellow-500 mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-text mb-2">
                    Performance Metrics Unavailable
                  </h3>
                  <p className="text-textMuted">
                    Unable to fetch performance metrics at this time
                  </p>
                </Card>
              )}
            </div>

            {/* System Information */}
            <div className="mb-8">
              <SectionHeader title="System Information" subtitle="Current system details" />
              
              {servicesLoading ? (
                <Card className="p-6">
                  <div className="flex items-center justify-center">
                    <LoadingSpinner />
                  </div>
                </Card>
              ) : servicesData ? (
                <Grid cols={{ default: 1, lg: 2 }} gap={6}>
                  <Card className="p-6">
                    <h3 className="text-lg font-bold text-text mb-4">Services Status</h3>
                    <div className="space-y-3">
                      {Object.entries(servicesData.services).map(([name, service]: [string, any]) => (
                        <div key={name} className="flex items-center justify-between">
                          <span className="text-sm text-text">{name}</span>
                          <div className="flex items-center gap-2">
                            {renderStatusIndicator(service.implementation === 'legacy' ? 'INACTIVE' : 'ACTIVE')}
                            <span className="text-xs text-textMuted">{service.implementation}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </Card>

                  <Card className="p-6">
                    <h3 className="text-lg font-bold text-text mb-4">Migration Progress</h3>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-text">Pure Services Enabled</span>
                        <span className="text-sm font-medium">{servicesData.summary.pureServicesEnabled}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-text">Total Services</span>
                        <span className="text-sm font-medium">{servicesData.summary.totalServices}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-text">Migration Progress</span>
                        <span className="text-sm font-medium">{servicesData.summary.migrationProgress}</span>
                      </div>
                    </div>
                  </Card>
                </Grid>
              ) : (
                <Card className="text-center py-8">
                  <AlertTriangle className="w-12 h-12 text-yellow-500 mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-text mb-2">
                    System Information Unavailable
                  </h3>
                  <p className="text-textMuted">
                    Unable to fetch system information at this time
                  </p>
                </Card>
              )}
            </div>
          </motion.div>
        )}

        {/* Users Tab */}
        {activeTab === "users" && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
          >
            <Card className="p-6">
              <h3 className="text-lg font-bold text-text mb-4">User Management</h3>
              <div className="text-center py-8">
                <UsersIcon className="w-12 h-12 text-textMuted mx-auto mb-4" />
                <h4 className="text-lg font-semibold text-text mb-2">
                  User Management Coming Soon
                </h4>
                <p className="text-textMuted">
                  This feature will allow you to manage users, roles, and permissions
                </p>
              </div>
            </Card>
          </motion.div>
        )}

        {/* System Tab */}
        {activeTab === "system" && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
          >
            <Card className="p-6">
              <h3 className="text-lg font-bold text-text mb-4">System Management</h3>
              <div className="text-center py-8">
                <Server className="w-12 h-12 text-textMuted mx-auto mb-4" />
                <h4 className="text-lg font-semibold text-text mb-2">
                  System Management Coming Soon
                </h4>
                <p className="text-textMuted">
                  This feature will allow you to manage system configuration and maintenance
                </p>
              </div>
            </Card>
          </motion.div>
        )}

        {/* Security Tab */}
        {activeTab === "security" && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
          >
            <Card className="p-6">
              <h3 className="text-lg font-bold text-text mb-4">Security & Monitoring</h3>
              <div className="text-center py-8">
                <Shield className="w-12 h-12 text-textMuted mx-auto mb-4" />
                <h4 className="text-lg font-semibold text-text mb-2">
                  Security Monitoring Coming Soon
                </h4>
                <p className="text-textMuted">
                  This feature will allow you to monitor security events and audit logs
                </p>
              </div>
            </Card>
          </motion.div>
        )}

        {/* Bots Tab */}
        {activeTab === "bots" && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
          >
            <Card className="p-6">
              <h3 className="text-lg font-bold text-text mb-4">Bot Management</h3>
              <div className="text-center py-8">
                <Bot className="w-12 h-12 text-textMuted mx-auto mb-4" />
                <h4 className="text-lg font-semibold text-text mb-2">
                  Bot Management Coming Soon
                </h4>
                <p className="text-textMuted">
                  This feature will allow you to manage bot instances and engine status
                </p>
              </div>
            </Card>
          </motion.div>
        )}

        {/* Settings Tab */}
        {activeTab === "settings" && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
          >
            <Card className="p-6">
              <h3 className="text-lg font-bold text-text mb-4">System Settings</h3>
              <div className="text-center py-8">
                <Settings className="w-12 h-12 text-textMuted mx-auto mb-4" />
                <h4 className="text-lg font-semibold text-text mb-2">
                  System Settings Coming Soon
                </h4>
                <p className="text-textMuted">
                  This feature will allow you to configure system settings and environment variables
                </p>
              </div>
            </Card>
          </motion.div>
        )}
      </Section>
    </Container>
  );
};

export default AdminDashboard;