import sql from 'mssql';

class KeepAliveService {
  constructor(dbPool) {
    this.dbPool = dbPool;
    this.intervalId = null;
    this.isRunning = false;
    this.pingInterval = 4 * 60 * 1000; // 4 minutes
  }

  async pingDatabase() {
    try {
      if (!this.dbPool || !this.dbPool.connected) {
        console.log('Database not connected, skipping ping');
        return false;
      }

      const request = this.dbPool.request();
      await request.query('SELECT 1 as ping');
      console.log('Database ping successful:', new Date().toISOString());
      return true;
    } catch (error) {
      console.error('Database ping failed:', error.message);
      return false;
    }
  }

  start() {
    if (this.isRunning) {
      console.log('Keep-alive service already running');
      return;
    }

    this.isRunning = true;
    
    // Initial ping
    this.pingDatabase();

    // Set up recurring pings
    this.intervalId = setInterval(() => {
      this.pingDatabase();
    }, this.pingInterval);

    console.log(`Keep-alive service started - pinging every ${this.pingInterval / 60000} minutes`);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    console.log('Keep-alive service stopped');
  }
}

export default KeepAliveService;