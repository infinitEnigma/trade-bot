/** @format */

// No direct React imports needed since we're using string-based icon names
// Icons are handled in the ErrorState component

// Error type configurations
export const errorConfigs = {
    network: {
        icon: "Wifi",
        title: "Connection Lost",
        message: "Unable to connect to our servers",
        description: "Please check your internet connection and try again.",
        color: "text-blue-400",
        bgColor: "bg-blue-500/10",
        borderColor: "border-blue-500/20",
    },
    auth: {
        icon: "Lock",
        title: "Authentication Required",
        message: "You need to sign in to continue",
        description: "Please log in to access this feature.",
        color: "text-orange-400",
        bgColor: "bg-orange-500/10",
        borderColor: "border-orange-500/20",
    },
    permission: {
        icon: "Shield",
        title: "Access Denied",
        message: "You don't have permission to view this",
        description: "Contact your administrator if you believe this is an error.",
        color: "text-yellow-400",
        bgColor: "bg-yellow-500/10",
        borderColor: "border-yellow-500/20",
    },
    validation: {
        icon: "AlertCircle",
        title: "Invalid Input",
        message: "Please check your information",
        description: "Some fields contain errors. Please review and try again.",
        color: "text-red-400",
        bgColor: "bg-red-500/10",
        borderColor: "border-red-500/20",
    },
    server: {
        icon: "Server",
        title: "Server Error",
        message: "Something went wrong on our end",
        description: "We're working to fix this issue. Please try again later.",
        color: "text-red-400",
        bgColor: "bg-red-500/10",
        borderColor: "border-red-500/20",
    },
    timeout: {
        icon: "Clock",
        title: "Request Timeout",
        message: "The request took too long to complete",
        description: "Please check your connection and try again.",
        color: "text-yellow-400",
        bgColor: "bg-yellow-500/10",
        borderColor: "border-yellow-500/20",
    },
    "not-found": {
        icon: "XCircle",
        title: "Not Found",
        message: "The page you're looking for doesn't exist",
        description: "The content may have been moved or deleted.",
        color: "text-gray-400",
        bgColor: "bg-gray-500/10",
        borderColor: "border-gray-500/20",
    },
    maintenance: {
        icon: "AlertTriangle",
        title: "Under Maintenance",
        message: "We're currently updating our systems",
        description: "We'll be back online shortly. Thank you for your patience.",
        color: "text-blue-400",
        bgColor: "bg-blue-500/10",
        borderColor: "border-blue-500/20",
    },
    "rate-limit": {
        icon: "Clock",
        title: "Too Many Requests",
        message: "You've made too many requests",
        description: "Please wait a moment before trying again.",
        color: "text-orange-400",
        bgColor: "bg-orange-500/10",
        borderColor: "border-orange-500/20",
    },
    unknown: {
        icon: "AlertTriangle",
        title: "Something Went Wrong",
        message: "An unexpected error occurred",
        description: "Please try again or contact support if the issue persists.",
        color: "text-red-400",
        bgColor: "bg-red-500/10",
        borderColor: "border-red-500/20",
    },
};

// Re-export types for convenience
export type { ErrorType, ErrorAction, ErrorStateProps } from "./error-types";
