import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import NotificationAlert from '../components/NotificationAlert';

const NotificationContext = createContext();

export const useNotification = () => {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotification must be used within a NotificationProvider');
  }
  return context;
};

export const NotificationProvider = ({ children }) => {
  const [notifications, setNotifications] = useState([]);

  const addNotification = useCallback((message, type = 'info') => {
    const id = Date.now();
    setNotifications((prev) => [...prev, { id, message, type }]);
    return id;
  }, []);

  const removeNotification = useCallback((id) => {
    setNotifications((prev) => prev.filter((notification) => notification.id !== id));
  }, []);

  // Clean up notifications on unmount
  useEffect(() => {
    return () => {
      setNotifications([]);
    };
  }, []);

  return (
    <NotificationContext.Provider value={{ addNotification, removeNotification }}>
      {children}
      <div className="fixed top-0 right-0 z-50">
        {notifications.map((notification, index) => (
          <NotificationAlert
            key={notification.id}
            message={notification.message}
            type={notification.type}
            onClose={() => removeNotification(notification.id)}
            index={index}
          />
        ))}
      </div>
    </NotificationContext.Provider>
  );
}; 