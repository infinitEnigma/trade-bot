/** @format */

import React from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";

export const LandingPage: React.FC = () => {
  const navigate = useNavigate();

  const handleLogin = () => {
    navigate("/login");
  };

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1,
        delayChildren: 0.2,
      },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 30 },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        duration: 0.6,
      },
    },
  };

  const features = [
    {
      icon: "🔄",
      title: "Automated Trading",
      description: "Rewire your trading strategy with intelligent algorithms that execute trades automatically based on your predefined rules.",
    },
    {
      icon: "📊",
      title: "Smart Analytics",
      description: "Gain deep insights into market trends with real-time data visualization and performance analytics.",
    },
    {
      icon: "🤖",
      title: "AI-Powered Strategies",
      description: "Leverage machine learning models to optimize your trading decisions and maximize returns.",
    },
    {
      icon: "💡",
      title: "Educational Resources",
      description: "Rewire your financial knowledge with comprehensive tutorials and market analysis.",
    },
    {
      icon: "🔒",
      title: "Secure Platform",
      description: "Bank-level security ensures your funds and personal information are always protected.",
    },
    {
      icon: "🌐",
      title: "Global Markets",
      description: "Access multiple cryptocurrency exchanges and trade on the world's largest digital asset markets.",
    },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-bg-primary via-purple-900/20 to-bg-primary overflow-hidden relative">
      {/* Background decoration */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-purple-500/10 rounded-full blur-3xl"></div>
        <div className="absolute top-1/2 left-1/4 w-60 h-60 bg-blue-500/10 rounded-full blur-3xl"></div>
        <div className="absolute bottom-0 right-1/3 w-96 h-96 bg-pink-500/10 rounded-full blur-3xl"></div>
      </div>

      {/* Navigation */}
      <nav className="relative z-10 px-6 py-6 flex justify-between items-center">
        <div className="flex items-center space-x-2">
          <div className="w-10 h-10 bg-gradient-to-br from-primary to-accent rounded-lg flex items-center justify-center">
            <span className="text-xl font-bold">R</span>
          </div>
          <span className="text-2xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
            Rewire
          </span>
        </div>
        <div className="flex items-center space-x-6">
          <button
            onClick={handleLogin}
            className="px-6 py-2.5 bg-gradient-to-r from-primary to-accent text-white rounded-lg font-medium hover:shadow-lg hover:shadow-primary/20 transition-all duration-300 transform hover:-translate-y-0.5"
          >
            Login
          </button>
        </div>
      </nav>

      {/* Hero section */}
      <main className="relative z-10 max-w-7xl mx-auto px-6 py-12">
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="text-center"
        >
          <motion.div variants={itemVariants} className="mb-8">
            <span className="inline-block px-4 py-1.5 bg-purple-500/10 text-primary border border-purple-500/20 rounded-full text-sm font-medium mb-6">
              Transform Your Trading Journey
            </span>
          </motion.div>

          <motion.h1
            variants={itemVariants}
            className="text-5xl md:text-7xl font-bold text-white mb-6 leading-tight"
          >
            Rewire Your
            <br />
            <span className="bg-gradient-to-r from-primary via-accent to-pink-500 bg-clip-text text-transparent">
              Financial Future
            </span>
          </motion.h1>

          <motion.p
            variants={itemVariants}
            className="text-xl text-text-secondary mb-10 max-w-3xl mx-auto leading-relaxed"
          >
            Discover a smarter way to trade. Our automated platform combines cutting-edge technology
            with intuitive design to help you rewire your approach to cryptocurrency trading.
          </motion.p>

          <motion.div variants={itemVariants} className="flex flex-col sm:flex-row gap-4 justify-center mb-16">
            <button
              onClick={handleLogin}
              className="px-8 py-4 bg-gradient-to-r from-primary to-accent text-white rounded-xl font-semibold text-lg hover:shadow-xl hover:shadow-primary/30 transition-all duration-300 transform hover:-translate-y-0.5 flex items-center justify-center gap-2"
            >
              Get Started <span className="text-lg">→</span>
            </button>
            <button className="px-8 py-4 bg-white/10 backdrop-blur-sm text-white rounded-xl font-semibold text-lg hover:bg-white/20 transition-all duration-300 border border-white/20">
              Learn More
            </button>
          </motion.div>
        </motion.div>

        {/* Features grid */}
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 mb-20"
        >
          {features.map((feature, index) => (
            <motion.div
              key={index}
              variants={itemVariants}
              whileHover={{ y: -8, transition: { duration: 0.2 } }}
              className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-8 hover:border-primary/30 transition-all duration-300"
            >
              <div className="w-16 h-16 bg-gradient-to-br from-primary/20 to-accent/20 rounded-xl flex items-center justify-center mb-6">
                <span className="text-2xl">{feature.icon}</span>
              </div>
              <h3 className="text-xl font-semibold text-white mb-3">{feature.title}</h3>
              <p className="text-text-secondary leading-relaxed">{feature.description}</p>
            </motion.div>
          ))}
        </motion.div>

        {/* About section */}
        <motion.div
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          className="max-w-4xl mx-auto text-center mb-20"
        >
          <motion.h2 variants={itemVariants} className="text-3xl font-bold text-white mb-6">
            Why Choose Rewire?
          </motion.h2>
          <motion.p variants={itemVariants} className="text-lg text-text-secondary mb-8 leading-relaxed">
            At Rewire, we believe in empowering traders with tools that help them rewire their
            financial habits and achieve their goals. Our platform is designed to be both powerful
            and accessible, whether you're a seasoned trader or just getting started.
          </motion.p>
          <motion.div variants={itemVariants} className="flex flex-wrap justify-center gap-4">
            <div className="px-6 py-3 bg-white/5 rounded-lg">
              <div className="text-3xl font-bold text-primary">99.9%</div>
              <div className="text-sm text-text-secondary">Uptime Guarantee</div>
            </div>
            <div className="px-6 py-3 bg-white/5 rounded-lg">
              <div className="text-3xl font-bold text-accent">24/7</div>
              <div className="text-sm text-text-secondary">Support</div>
            </div>
            <div className="px-6 py-3 bg-white/5 rounded-lg">
              <div className="text-3xl font-bold text-pink-500">10K+</div>
              <div className="text-sm text-text-secondary">Active Traders</div>
            </div>
          </motion.div>
        </motion.div>

        {/* CTA section */}
        <motion.div
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          className="bg-gradient-to-r from-primary/20 to-accent/20 rounded-2xl p-12 border border-primary/30"
        >
          <motion.div variants={itemVariants} className="text-center">
            <h2 className="text-3xl font-bold text-white mb-4">Ready to Rewire Your Trading?</h2>
            <p className="text-lg text-text-secondary mb-8 max-w-2xl mx-auto">
              Join thousands of traders who have transformed their approach with our automated platform.
            </p>
            <button
              onClick={handleLogin}
              className="px-10 py-4 bg-gradient-to-r from-primary to-accent text-white rounded-xl font-semibold text-lg hover:shadow-xl hover:shadow-primary/30 transition-all duration-300 transform hover:-translate-y-0.5"
            >
              Start Trading Today
            </button>
          </motion.div>
        </motion.div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 py-12 border-t border-white/10 mt-20">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex flex-col md:flex-row justify-between items-center">
            <div className="flex items-center space-x-2 mb-6 md:mb-0">
              <div className="w-8 h-8 bg-gradient-to-br from-primary to-accent rounded flex items-center justify-center">
                <span className="text-sm font-bold">R</span>
              </div>
              <span className="text-xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                Rewire
              </span>
            </div>
            <div className="flex space-x-6 text-text-secondary">
              <a href="#" className="hover:text-primary transition-colors">Terms</a>
              <a href="#" className="hover:text-primary transition-colors">Privacy</a>
              <a href="#" className="hover:text-primary transition-colors">Contact</a>
              <a href="#" className="hover:text-primary transition-colors">Support</a>
            </div>
          </div>
          <div className="mt-8 text-center text-text-tertiary text-sm">
            © 2024 Rewire. All rights reserved. Trading involves risk. Please invest responsibly.
          </div>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;