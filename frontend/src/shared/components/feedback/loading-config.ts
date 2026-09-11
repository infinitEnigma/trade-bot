/** @format */

// Loading States Configuration
export const LoadingStates = {
    creatingStrategy: {
        message: "Creating your trading strategy...",
        steps: ["Validating parameters", "Connecting to exchange", "Deploying strategy"],
    },

    startingBot: {
        message: "Starting trading bot...",
        steps: ["Initializing engine", "Connecting to exchange", "Starting automated trading"],
    },

    stoppingBot: {
        message: "Stopping trading bot...",
        steps: ["Sending stop signal", "Closing positions", "Shutting down engine"],
    },

    checkingQualification: {
        message: "Verifying wallet qualification...",
        steps: ["Connecting to wallet", "Checking NFT ownership", "Validating token balance"],
    },

    loadingPortfolio: {
        message: "Loading portfolio data...",
        subtitle: "Fetching positions, balances, and trading history",
    },

    loadingStrategies: {
        message: "Loading trading strategies...",
        subtitle: "Fetching your automated trading configurations",
    },

    loadingAnalytics: {
        message: "Loading analytics data...",
        subtitle: "Processing performance metrics and trading statistics",
    },

    savingChanges: {
        message: "Saving your changes...",
        subtitle: "Updating profile and preferences",
    },
};