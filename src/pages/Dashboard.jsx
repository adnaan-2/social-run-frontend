import { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  Footprints,
  LogOut,
  Flame,
  MapPin,
  Activity,
  Trophy,
  Play,
  Pause,
  Square,
  Users,
  Check,
  X,
  Send,
  Award,
  Sparkles,
  Compass,
  MessageCircle,
  Bell,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import L from 'leaflet';
import ParticleField from '../components/ParticleField';

// Fix for default Leaflet marker icons
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// Helper function to calculate distance between two coordinates in meters
function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // metres
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // in meters
}

const ACTIVE_WALK_STORAGE_KEY = 'activeWalkSession';
const PENDING_SYNC_WALKS_KEY = 'pendingSyncWalks';
const WALK_REMINDER_KEY = 'walkReminder';

const parseJson = (value, fallback) => {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
};

export default function Dashboard() {
  const { user, setUser, logout, socket } = useAuth();
  const navigate = useNavigate();

  // Profile dialog state
  const [isProfileDialogOpen, setIsProfileDialogOpen] = useState(false);

  // Social state
  const [nearbyWalkers, setNearbyWalkers] = useState([]);
  const [selectedWalker, setSelectedWalker] = useState(null);
  const [pendingRequests, setPendingRequests] = useState({ incoming: [], outgoing: [] });
  const [followingList, setFollowingList] = useState([]);
  const [activeTab, setActiveTab] = useState('nearby'); // 'nearby' | 'following' | 'invites'

  // Walk Session state
  const [isWalking, setIsWalking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isAutoPaused, setIsAutoPaused] = useState(false);
  const [walkSession, setWalkSession] = useState(null);
  const [duration, setDuration] = useState(0); // in seconds
  const [distance, setDistance] = useState(0); // in meters
  const [coordinates, setCoordinates] = useState([]); // Array of {lat, lng, timestamp}
  const [isBuddyWalk, setIsBuddyWalk] = useState(false);
  const [buddyUser, setBuddyUser] = useState(null);

  // Simulated walking state
  const [isSimulating, setIsSimulating] = useState(false);
  const simulationInterval = useRef(null);

  // Walk completion celebration state
  const [showCelebration, setShowCelebration] = useState(false);
  const [completionSummary, setCompletionSummary] = useState(null);

  // Chat state
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatBuddy, setChatBuddy] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [unreadByUser, setUnreadByUser] = useState({});

  // Reminder state
  const [reminderTime, setReminderTime] = useState('08:30');
  const [quickReminderMinutes, setQuickReminderMinutes] = useState(15);
  const [isReminderEnabled, setIsReminderEnabled] = useState(false);

  // History state
  const [walkHistory, setWalkHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  // Leaflet Map Refs
  const mapContainerRef = useRef(null);
  const activeMapContainerRef = useRef(null);
  const mainMap = useRef(null);
  const activeWalkMap = useRef(null);
  const userMarker = useRef(null);
  const buddyMarker = useRef(null);
  const routePolyline = useRef(null);
  const nearbyMarkers = useRef(new Map()); // userId -> marker

  // Watch position ID
  const watchId = useRef(null);
  const timerInterval = useRef(null);
  const reminderInterval = useRef(null);
  const reminderTimeout = useRef(null);
  const autoPauseTicks = useRef(0);
  const chatEndRef = useRef(null);
  const isPausedRef = useRef(false);
  const isAutoPausedRef = useRef(false);

  // User location cache
  const [userLocation, setUserLocation] = useState(null);

  const stopTimer = () => {
    if (timerInterval.current) {
      clearInterval(timerInterval.current);
      timerInterval.current = null;
    }
  };

  const startTimer = () => {
    stopTimer();
    timerInterval.current = setInterval(() => {
      setDuration((d) => d + 1);
    }, 1000);
  };

  const persistActiveWalk = (payload) => {
    localStorage.setItem(ACTIVE_WALK_STORAGE_KEY, JSON.stringify(payload));
  };

  const clearPersistedActiveWalk = () => {
    localStorage.removeItem(ACTIVE_WALK_STORAGE_KEY);
  };

  const queuePendingSyncWalk = (payload) => {
    const queue = parseJson(localStorage.getItem(PENDING_SYNC_WALKS_KEY), []);
    queue.push(payload);
    localStorage.setItem(PENDING_SYNC_WALKS_KEY, JSON.stringify(queue));
  };

  const syncPendingWalks = async () => {
    if (!navigator.onLine) return;
    const queue = parseJson(localStorage.getItem(PENDING_SYNC_WALKS_KEY), []);
    if (!queue.length) return;

    const remaining = [];
    for (const item of queue) {
      try {
        if (item.offlineOnly) {
          const startRes = await api.post('/walks/start', {
            startTime: item.startTime,
            type: item.payload.type || 'walk',
          });
          await api.post(`/walks/end/${startRes.data.walkSession._id}`, item.payload);
        } else {
          await api.post(`/walks/end/${item.sessionId}`, item.payload);
        }
      } catch {
        remaining.push(item);
      }
    }

    localStorage.setItem(PENDING_SYNC_WALKS_KEY, JSON.stringify(remaining));
    if (!remaining.length) {
      try {
        const freshUser = await api.get('/auth/me');
        setUser(freshUser.data.user);
        fetchHistory();
      } catch (err) {
        console.error(err);
      }
    }
  };

  const playReminderSound = () => {
    const context = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = 780;
    oscillator.connect(gain);
    gain.connect(context.destination);
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.1, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.5);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.5);
  };

  const triggerReminder = () => {
    playReminderSound();
    window.alert('Walk reminder: time to move!');
    if ('Notification' in window) {
      if (Notification.permission === 'granted') {
        // ponytail: browser-level reminder, in-app alert covers unsupported browsers.
        new Notification('WalkStreak Reminder', {
          body: 'Time for your walk.',
        });
      } else if (Notification.permission === 'default') {
        Notification.requestPermission();
      }
    }
  };

  // Fetch initial dashboard data
  useEffect(() => {
    fetchHistory();
    fetchSocialData();
    getCurrentLocation();

    // Set up periodic refresh for nearby walkers
    const interval = setInterval(() => {
      if (userLocation) {
        fetchNearbyWalkers(userLocation.lng, userLocation.lat);
      }
    }, 15000);

    return () => {
      clearInterval(interval);
      if (watchId.current) navigator.geolocation.clearWatch(watchId.current);
      if (timerInterval.current) clearInterval(timerInterval.current);
      if (simulationInterval.current) clearInterval(simulationInterval.current);
      if (reminderInterval.current) clearInterval(reminderInterval.current);
      if (reminderTimeout.current) clearTimeout(reminderTimeout.current);
      if (mainMap.current) {
        mainMap.current.remove();
        mainMap.current = null;
      }
      if (activeWalkMap.current) {
        activeWalkMap.current.remove();
        activeWalkMap.current = null;
      }
      userMarker.current = null;
      routePolyline.current = null;
      buddyMarker.current = null;
    };
  }, []);

  // Set up socket listeners
  useEffect(() => {
    if (!socket) return;

    socket.on('location_updated', (data) => {
      const { userId, lat, lng } = data;
      // Update nearby walkers state
      setNearbyWalkers((prev) =>
        prev.map((w) => {
          if (w._id === userId) {
            return {
              ...w,
              currentLocation: { type: 'Point', coordinates: [lng, lat] },
            };
          }
          return w;
        })
      );

      // Update map marker if main map is loaded
      if (mainMap.current && nearbyMarkers.current.has(userId)) {
        const marker = nearbyMarkers.current.get(userId);
        marker.setLatLng([lat, lng]);
      }
    });

    socket.on('user_online', (data) => {
      if (userLocation) {
        fetchNearbyWalkers(userLocation.lng, userLocation.lat);
      }
    });

    socket.on('user_offline', (data) => {
      const { userId } = data;
      setNearbyWalkers((prev) => prev.filter((w) => w._id !== userId));
      if (mainMap.current && nearbyMarkers.current.has(userId)) {
        const marker = nearbyMarkers.current.get(userId);
        marker.remove();
        nearbyMarkers.current.delete(userId);
      }
    });

    socket.on('walk_request_received', (data) => {
      // Refresh invites
      fetchSocialData();
      // Visual notification could go here, but tab highlights suffice
    });

    socket.on('walk_request_responded', (data) => {
      const { requestId, receiverId, status } = data;
      fetchSocialData();

      if (status === 'accepted') {
        // Find the user info
        api.get('/social/requests').then((res) => {
          const matchingRequest = res.data.incoming
            .concat(res.data.outgoing)
            .find((r) => r._id === requestId || (r.senderId._id === receiverId && r.status === 'accepted'));

          const partner =
            matchingRequest?.receiverId._id === receiverId
              ? matchingRequest.receiverId
              : matchingRequest?.senderId;

          if (partner) {
            // Start Buddy Walk
            initiateWalk(true, partner);
          }
        });
      }
    });

    // Buddy coordinate stream
    socket.on('buddy_location_stream', (data) => {
      const { lat, lng, speed, timestamp } = data;
      if (activeWalkMap.current) {
        if (!buddyMarker.current) {
          const buddyIcon = L.divIcon({
            html: `<div style="width: 16px; height: 16px; border-radius: 50%; background: var(--accent-secondary); border: 2px solid white; box-shadow: 0 0 10px var(--accent-secondary);"></div>`,
            className: 'buddy-location-icon',
          });
          buddyMarker.current = L.marker([lat, lng], { icon: buddyIcon }).addTo(activeWalkMap.current);
        } else {
          buddyMarker.current.setLatLng([lat, lng]);
        }
      }
    });

    socket.on('receive_message', (incomingMessage) => {
      const senderId = incomingMessage.senderId || incomingMessage.sender?._id;
      if (chatBuddy && senderId === chatBuddy._id) {
        setChatMessages((prev) => [...prev, incomingMessage]);
      } else if (senderId) {
        setUnreadByUser((prev) => ({ ...prev, [senderId]: (prev[senderId] || 0) + 1 }));
      }
    });

    socket.on('message_sent', (sentMessage) => {
      if (chatBuddy && sentMessage.receiverId === chatBuddy._id) {
        setChatMessages((prev) => [...prev, sentMessage]);
      }
    });

    // Notify other users on connection/reconnection
    if (userLocation) {
      socket.emit('update_location', { lat: userLocation.lat, lng: userLocation.lng });
    }

    return () => {
      socket.off('location_updated');
      socket.off('user_online');
      socket.off('user_offline');
      socket.off('walk_request_received');
      socket.off('walk_request_responded');
      socket.off('buddy_location_stream');
      socket.off('receive_message');
      socket.off('message_sent');
    };
  }, [socket, userLocation, chatBuddy]);

  useEffect(() => {
    const onOnline = () => {
      syncPendingWalks();
    };
    window.addEventListener('online', onOnline);
    syncPendingWalks();
    return () => window.removeEventListener('online', onOnline);
  }, []);

  useEffect(() => {
    if (!isWalking || !walkSession) return;
    persistActiveWalk({
      walkSession,
      duration,
      distance,
      coordinates,
      isBuddyWalk,
      buddyUser,
      isPaused,
      isAutoPaused,
      savedAt: Date.now(),
    });
  }, [isWalking, walkSession, duration, distance, coordinates, isBuddyWalk, buddyUser, isPaused, isAutoPaused]);

  useEffect(() => {
    const stored = parseJson(localStorage.getItem(WALK_REMINDER_KEY), null);
    if (!stored) return;
    setReminderTime(stored.reminderTime || '08:30');
    setIsReminderEnabled(!!stored.isReminderEnabled);
  }, []);

  useEffect(() => {
    localStorage.setItem(
      WALK_REMINDER_KEY,
      JSON.stringify({
        reminderTime,
        isReminderEnabled,
      })
    );
  }, [reminderTime, isReminderEnabled]);

  useEffect(() => {
    if (reminderInterval.current) clearInterval(reminderInterval.current);
    if (!isReminderEnabled) return;
    reminderInterval.current = setInterval(() => {
      const now = new Date();
      const hhmm = `${`${now.getHours()}`.padStart(2, '0')}:${`${now.getMinutes()}`.padStart(2, '0')}`;
      if (hhmm !== reminderTime) return;
      const lastKey = `walkReminder:last:${hhmm}`;
      const lastDay = localStorage.getItem(lastKey);
      const today = now.toDateString();
      if (lastDay === today) return;
      localStorage.setItem(lastKey, today);
      triggerReminder();
    }, 30000);

    return () => {
      if (reminderInterval.current) clearInterval(reminderInterval.current);
    };
  }, [isReminderEnabled, reminderTime]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  useEffect(() => {
    isAutoPausedRef.current = isAutoPaused;
  }, [isAutoPaused]);

  // Load Main Map once container is rendered & user location is available
  useEffect(() => {
    if (!mapContainerRef.current || isWalking) return;

    if (!mainMap.current) {
      // Default to [0,0], we will pan to user location shortly
      mainMap.current = L.map(mapContainerRef.current, {
        zoomControl: false,
      }).setView([0, 0], 2);

      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
        subdomains: 'abcd',
        maxZoom: 20,
      }).addTo(mainMap.current);
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
        subdomains: 'abcd',
        maxZoom: 20,
        opacity: 0.95,
      }).addTo(mainMap.current);

      // Add Zoom Control at bottom right
      L.control.zoom({ position: 'bottomright' }).addTo(mainMap.current);
    }

    if (userLocation && mainMap.current) {
      mainMap.current.setView([userLocation.lat, userLocation.lng], 14);

      if (!userMarker.current) {
        const userIcon = L.divIcon({
          html: `<div style="width: 20px; height: 20px; border-radius: 50%; background: var(--accent-primary); border: 3px solid white; box-shadow: 0 0 15px var(--accent-primary); animation: pulse-glow 2s infinite;"></div>`,
          className: 'user-location-icon',
        });
        userMarker.current = L.marker([userLocation.lat, userLocation.lng], { icon: userIcon }).addTo(
          mainMap.current
        );
      } else {
        userMarker.current.setLatLng([userLocation.lat, userLocation.lng]);
      }
    }

    // Render nearby walker pins
    renderNearbyWalkersOnMap();
    requestAnimationFrame(() => mainMap.current?.invalidateSize());
  }, [mapContainerRef, userLocation, nearbyWalkers, isWalking]);

  // Load Active Walk Map
  useEffect(() => {
    if (!activeMapContainerRef.current || !isWalking) return;

    if (!activeWalkMap.current) {
      activeWalkMap.current = L.map(activeMapContainerRef.current, {
        zoomControl: false,
      }).setView(
        userLocation ? [userLocation.lat, userLocation.lng] : [0, 0],
        16
      );

      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        subdomains: 'abcd',
        maxZoom: 20,
      }).addTo(activeWalkMap.current);
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
        subdomains: 'abcd',
        maxZoom: 20,
        opacity: 0.95,
      }).addTo(activeWalkMap.current);

      routePolyline.current = L.polyline([], {
        color: 'var(--accent-primary)',
        weight: 6,
        opacity: 0.9,
      }).addTo(activeWalkMap.current);
    }
    requestAnimationFrame(() => activeWalkMap.current?.invalidateSize());
  }, [activeMapContainerRef, isWalking]);

  useEffect(() => {
    if (isWalking || !activeWalkMap.current) return;
    activeWalkMap.current.remove();
    activeWalkMap.current = null;
    routePolyline.current = null;
    buddyMarker.current = null;
  }, [isWalking]);

  // Render nearby markers helper
  const renderNearbyWalkersOnMap = () => {
    if (!mainMap.current) return;

    // Remove obsolete markers
    const walkerIds = new Set(nearbyWalkers.map((w) => w._id));
    for (const [uid, marker] of nearbyMarkers.current.entries()) {
      if (!walkerIds.has(uid)) {
        marker.remove();
        nearbyMarkers.current.delete(uid);
      }
    }

    // Add/Update markers
    nearbyWalkers.forEach((w) => {
      const coords = w.currentLocation?.coordinates;
      if (!coords || coords.length < 2 || (coords[0] === 0 && coords[1] === 0)) return;

      const lat = coords[1];
      const lng = coords[0];

      if (nearbyMarkers.current.has(w._id)) {
        nearbyMarkers.current.get(w._id).setLatLng([lat, lng]);
      } else {
        const avatar =
          w.profilePhoto && w.profilePhoto.trim()
            ? `<img src="${w.profilePhoto}" alt="${w.username}" style="width:36px;height:36px;border-radius:50%;object-fit:cover;" />`
            : `<div style="width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#00d4aa,#198754);display:flex;align-items:center;justify-content:center;font-weight:700;color:white;">${w.username[0].toUpperCase()}</div>`;
        const glowColor = w.isOnline ? '#00d4aa' : '#6b7280';
        const divIcon = L.divIcon({
          html: `<div style="display:flex;flex-direction:column;align-items:center;gap:4px;transform:translateY(-18px)"><div style="padding:2px;border-radius:9999px;border:2px solid ${glowColor};box-shadow:0 0 12px ${glowColor};background:#0b0f0d;">${avatar}</div><div style="font-size:11px;font-weight:700;color:white;text-shadow:0 1px 4px rgba(0,0,0,0.8);">${w.username}</div></div>`,
          className: 'nearby-walker-icon',
          iconSize: [70, 64],
          iconAnchor: [35, 50],
        });
        const marker = L.marker([lat, lng], { icon: divIcon }).addTo(mainMap.current);
        marker.on('click', () => setSelectedWalker(w));
        nearbyMarkers.current.set(w._id, marker);
      }
    });
  };

  const getCurrentLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const loc = { lat: position.coords.latitude, lng: position.coords.longitude };
          setUserLocation(loc);
          // Fetch nearby users once location is available
          fetchNearbyWalkers(loc.lng, loc.lat);
          // Emit socket location update
          if (socket) {
            socket.emit('update_location', { lat: loc.lat, lng: loc.lng });
          }
        },
        (error) => {
          console.warn('Geolocation access failed. Using default location.');
          const defaultLoc = { lat: 40.7128, lng: -74.006 }; // New York
          setUserLocation(defaultLoc);
        }
      );
    }
  };

  const fetchHistory = async () => {
    try {
      setHistoryLoading(true);
      const res = await api.get('/walks/history');
      setWalkHistory(res.data.walks);
    } catch (err) {
      console.error(err);
    } finally {
      setHistoryLoading(false);
    }
  };

  const fetchSocialData = async () => {
    try {
      const requestsRes = await api.get('/social/requests');
      setPendingRequests({
        incoming: requestsRes.data.incoming,
        outgoing: requestsRes.data.outgoing,
      });

      const followingRes = await api.get('/social/following');
      setFollowingList(followingRes.data.following);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchNearbyWalkers = async (lng, lat) => {
    try {
      const res = await api.get(`/social/nearby?lng=${lng}&lat=${lat}`);
      setNearbyWalkers(res.data.walkers);
    } catch (err) {
      console.error(err);
    }
  };

  // Follow/Unfollow user
  const handleFollowToggle = async (walker) => {
    try {
      if (walker.isFollowing) {
        await api.post(`/social/unfollow/${walker._id}`);
      } else {
        await api.post(`/social/follow/${walker._id}`);
      }
      // Update state
      setNearbyWalkers((prev) =>
        prev.map((w) => (w._id === walker._id ? { ...w, isFollowing: !w.isFollowing } : w))
      );
      setSelectedWalker((prev) =>
        prev && prev._id === walker._id ? { ...prev, isFollowing: !prev.isFollowing } : prev
      );
      fetchSocialData();
    } catch (err) {
      console.error(err);
    }
  };

  // Send walk invite
  const handleInviteToWalk = async (walkerId) => {
    try {
      const res = await api.post('/social/requests', { receiverId: walkerId });
      // Emit socket notification
      if (socket) {
        socket.emit('send_walk_request', {
          receiverId: walkerId,
          requestId: res.data.request._id,
          senderUsername: user.username,
        });
      }
      fetchSocialData();
    } catch (err) {
      console.error(err);
    }
  };

  // Respond to request
  const handleRespondRequest = async (requestId, senderId, status) => {
    try {
      await api.post(`/social/requests/${requestId}/respond`, { status });
      if (socket) {
        socket.emit('respond_walk_request', {
          requestId,
          senderId,
          status,
        });
      }
      fetchSocialData();
    } catch (err) {
      console.error(err);
    }
  };

  const openChatWith = async (walker) => {
    setChatBuddy(walker);
    setIsChatOpen(true);
    setUnreadByUser((prev) => ({ ...prev, [walker._id]: 0 }));
    setChatLoading(true);
    try {
      const res = await api.get(`/social/messages/${walker._id}`);
      setChatMessages(res.data.messages);
    } catch (err) {
      console.error(err);
      setChatMessages([]);
    } finally {
      setChatLoading(false);
    }
  };

  const handleSendMessage = async () => {
    if (!chatBuddy || !chatInput.trim()) return;
    const content = chatInput.trim();
    setChatInput('');
    try {
      if (socket) {
        socket.emit('send_message', { receiverId: chatBuddy._id, content });
      } else {
        const res = await api.post('/social/messages', { receiverId: chatBuddy._id, content });
        setChatMessages((prev) => [...prev, res.data.message]);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleQuickReminder = () => {
    if (reminderTimeout.current) clearTimeout(reminderTimeout.current);
    reminderTimeout.current = setTimeout(() => {
      triggerReminder();
    }, Math.max(1, quickReminderMinutes) * 60 * 1000);
  };

  // Start walk session
  const initiateWalk = async (buddyMode = false, buddy = null) => {
    try {
      setIsWalking(true);
      setIsPaused(false);
      setIsAutoPaused(false);
      autoPauseTicks.current = 0;
      setDuration(0);
      setDistance(0);
      setCoordinates([]);
      setIsBuddyWalk(buddyMode);
      setBuddyUser(buddy);

      let session;
      try {
        const startRes = await api.post('/walks/start', {
          startTime: new Date(),
          isBuddyWalk: buddyMode,
          buddyUserId: buddy ? buddy._id : undefined,
        });
        session = startRes.data.walkSession;
      } catch (startError) {
        if (!navigator.onLine) {
          session = {
            _id: `offline-${Date.now()}`,
            startTime: new Date().toISOString(),
            offlineOnly: true,
          };
        } else {
          throw startError;
        }
      }
      setWalkSession(session);

      // Notify buddy via Socket
      if (buddyMode && buddy && socket && !session.offlineOnly) {
        socket.emit('buddy_walk_start', {
          buddyId: buddy._id,
          walkSessionId: session._id,
        });
      }

      // Initialize local trace with current location
      let initialCoords = [];
      if (userLocation) {
        initialCoords.push({ lat: userLocation.lat, lng: userLocation.lng, timestamp: new Date() });
        setCoordinates(initialCoords);
      }

      // Start timer
      startTimer();

      // Start Geolocation watch
      if (navigator.geolocation && !isSimulating) {
        watchId.current = navigator.geolocation.watchPosition(
          (position) => {
            const { latitude, longitude, speed } = position.coords;
            const newCoord = {
              lat: latitude,
              lng: longitude,
              timestamp: new Date(),
              speed: speed || 0,
            };

            setCoordinates((prev) => {
              const last = prev[prev.length - 1];
              let updated = [...prev];
              const distIncrement = last ? getDistance(last.lat, last.lng, latitude, longitude) : 0;

              // Auto-pause when user is mostly still.
              if ((speed || 0) < 0.3 || distIncrement < 1.5) {
                autoPauseTicks.current += 1;
              } else {
                autoPauseTicks.current = 0;
              }
              if (!isAutoPausedRef.current && autoPauseTicks.current >= 5) {
                setIsAutoPaused(true);
                stopTimer();
              } else if (isAutoPausedRef.current && ((speed || 0) > 0.5 || distIncrement > 3)) {
                setIsAutoPaused(false);
                if (!isPausedRef.current) startTimer();
              }

              if (isPausedRef.current || isAutoPausedRef.current) {
                return updated;
              }

              // Check if moved
              if (last) {
                if (distIncrement > 1.5) {
                  setDistance((d) => d + distIncrement);
                  updated.push(newCoord);

                  // Draw on map
                  if (routePolyline.current) {
                    routePolyline.current.addLatLng([latitude, longitude]);
                  }
                  if (activeWalkMap.current) {
                    activeWalkMap.current.panTo([latitude, longitude]);
                  }
                }
              } else {
                updated.push(newCoord);
              }
              return updated;
            });

            // Emit live location updates
            if (socket) {
              socket.emit('update_location', { lat: latitude, lng: longitude });
              if (buddyMode && buddy) {
                socket.emit('buddy_coordinates', {
                  buddyId: buddy._id,
                  lat: latitude,
                  lng: longitude,
                  speed: speed || 0,
                  timestamp: new Date(),
                });
              }
            }
          },
          (err) => console.error(err),
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
      }
    } catch (err) {
      console.error(err);
      setIsWalking(false);
    }
  };

  // Toggle simulation
  const handleToggleSimulation = () => {
    if (isSimulating) {
      // Turn off simulation
      clearInterval(simulationInterval.current);
      setIsSimulating(false);
    } else {
      // Turn on simulation
      setIsSimulating(true);
      // Start moving automatically
      let simulatedLat = userLocation?.lat || 40.7128;
      let simulatedLng = userLocation?.lng || -74.006;

      simulationInterval.current = setInterval(() => {
        if (isPausedRef.current || isAutoPausedRef.current) return;

        // Take a step (approx 5-15 meters in random direction)
        const step = 0.0001 + Math.random() * 0.0001; // degrees
        const angle = Math.random() * Math.PI * 2;
        simulatedLat += Math.sin(angle) * step;
        simulatedLng += Math.cos(angle) * step;

        const newCoord = {
          lat: simulatedLat,
          lng: simulatedLng,
          timestamp: new Date(),
          speed: 1.4, // avg walking speed m/s
        };

        setCoordinates((prev) => {
          const last = prev[prev.length - 1];
          let updated = [...prev];
          if (last) {
            const distIncrement = getDistance(last.lat, last.lng, simulatedLat, simulatedLng);
            setDistance((d) => d + distIncrement);
          }
          updated.push(newCoord);

          // Update active map
          if (routePolyline.current) {
            routePolyline.current.addLatLng([simulatedLat, simulatedLng]);
          }
          if (activeWalkMap.current) {
            activeWalkMap.current.panTo([simulatedLat, simulatedLng]);
          }

          return updated;
        });

        // Emit location via Socket
        if (socket) {
          socket.emit('update_location', { lat: simulatedLat, lng: simulatedLng });
          if (isBuddyWalk && buddyUser) {
            socket.emit('buddy_coordinates', {
              buddyId: buddyUser._id,
              lat: simulatedLat,
              lng: simulatedLng,
              speed: 1.4,
              timestamp: new Date(),
            });
          }
        }
      }, 3000);
    }
  };

  // Pause walk
  const handlePauseToggle = () => {
    if (isPaused) {
      setIsPaused(false);
      if (!isAutoPausedRef.current) startTimer();
    } else {
      setIsPaused(true);
      stopTimer();
    }
  };

  // End walk session
  const handleEndWalk = async () => {
    // Stop timers, watch, simulation
    stopTimer();
    if (watchId.current) navigator.geolocation.clearWatch(watchId.current);
    if (simulationInterval.current) clearInterval(simulationInterval.current);

    try {
      const payload = {
        endTime: new Date(),
        distance: Math.round(distance),
        duration,
        coordinates,
        steps: Math.round(distance * (isBuddyWalk ? 1.0 : 1.31)),
        type: 'walk',
      };

      let res;
      if (walkSession?.offlineOnly) {
        queuePendingSyncWalk({
          offlineOnly: true,
          startTime: walkSession.startTime,
          payload,
        });
      } else {
        try {
          res = await api.post(`/walks/end/${walkSession._id}`, payload);
        } catch (endError) {
          if (navigator.onLine) {
            throw endError;
          }
          queuePendingSyncWalk({
            sessionId: walkSession._id,
            payload,
          });
        }
      }

      const walkResult =
        res?.data?.walkSession ||
        ({
          distance: Math.round(distance),
          duration,
          averagePace: distance > 0 ? (duration / 60) / (distance / 1000) : 0,
        });
      setCompletionSummary({
        walk: walkResult,
        earnedXp: res?.data?.earnedXp || 0,
        isLevelUp: res?.data?.isLevelUp || false,
        newBadges: res?.data?.newBadges || [],
      });
      setShowCelebration(true);

      if (res?.data?.user) {
        setUser(res.data.user);
      }

      // Refresh walk history
      fetchHistory();
    } catch (err) {
      console.error(err);
    } finally {
      // Clean up variables
      setIsWalking(false);
      setIsPaused(false);
      setIsAutoPaused(false);
      setWalkSession(null);
      setDuration(0);
      setDistance(0);
      setCoordinates([]);
      setIsSimulating(false);
      clearPersistedActiveWalk();
      if (buddyMarker.current) buddyMarker.current.remove();
      if (activeWalkMap.current) activeWalkMap.current.remove();
      buddyMarker.current = null;
      routePolyline.current = null;
      activeWalkMap.current = null;
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  // Calculate Pace (min/km)
  const formatPace = () => {
    if (distance <= 0) return '0:00';
    const distanceKm = distance / 1000;
    const paceMin = duration / 60 / distanceKm;
    const mins = Math.floor(paceMin);
    const secs = Math.round((paceMin - mins) * 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  // Format elapsed time (hh:mm:ss)
  const formatTime = (secs) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return `${h > 0 ? h + ':' : ''}${m < 10 && h > 0 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const stats = [
    {
      label: 'Current Streak',
      value: user?.currentStreak || 0,
      unit: 'days',
      icon: '🔥',
      color: 'var(--accent-primary)',
    },
    {
      label: 'Total Distance',
      value: ((user?.totalDistance || 0) / 1000).toFixed(1),
      unit: 'km',
      iconComponent: MapPin,
      color: '#38bdf8',
    },
    {
      label: 'Total Walks',
      value: user?.totalWalks || 0,
      unit: 'walks',
      iconComponent: Activity,
      color: '#f472b6',
    },
    {
      label: 'Level',
      value: user?.level || 1,
      unit: null,
      iconComponent: Trophy,
      color: '#fbbf24',
      isLevel: true,
    },
  ];

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', position: 'relative' }}>
      <ParticleField />
      {/* ===== NAVBAR ===== */}
      <nav
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 50,
          background: 'rgba(10, 15, 13, 0.85)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderBottom: '1px solid var(--glass-border)',
          padding: '12px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
          <Footprints size={28} style={{ color: 'var(--accent-primary)' }} strokeWidth={1.5} />
          <span className="gradient-text" style={{ fontSize: 22, fontWeight: 800, letterSpacing: -0.5 }}>
            WalkStreak
          </span>
        </Link>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
          Hey, {user?.username || 'Walker'}!
        </span>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            padding: '4px 8px',
            borderRadius: 999,
            background: 'rgba(0, 212, 170, 0.15)',
            border: '1px solid rgba(0, 212, 170, 0.3)',
            color: 'var(--accent-primary)',
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          🔥 {user?.currentStreak || 0}d
        </span>
        <button
          onClick={() => setIsProfileDialogOpen(true)}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            padding: 0,
          }}
          aria-label="Open profile stats"
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              background: 'var(--accent-gradient)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 14,
              fontWeight: 700,
              color: 'white',
              overflow: 'hidden',
            }}
          >
            {user?.profilePhoto ? (
              <img
                src={user.profilePhoto}
                alt={user.username}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              (user?.username || 'W')[0].toUpperCase()
            )}
          </div>
        </button>
        </div>
      </nav>

      {/* ===== ACTIVE WALK SCREEN OVERLAY ===== */}
      {isWalking && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 100,
            background: 'var(--bg-primary)',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Active Walk Map */}
          <div style={{ flex: 1, position: 'relative', background: '#0b1117' }}>
            <div
              ref={activeMapContainerRef}
              style={{
                width: '100%',
                height: '100%',
                filter: 'contrast(1.08) brightness(1.12) saturate(1.12)',
              }}
            />

            {/* Simulating Overlay Watermark */}
            {isSimulating && (
              <div
                style={{
                  position: 'absolute',
                  top: 20,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  background: 'rgba(15, 81, 50, 0.9)',
                  padding: '6px 14px',
                  borderRadius: 20,
                  fontSize: 12,
                  fontWeight: 600,
                  zIndex: 1000,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  boxShadow: '0 0 15px rgba(15, 81, 50, 0.25)',
                  color: 'white',
                }}
              >
                <Sparkles size={14} />
                Simulated Walking Active
              </div>
            )}
            {isAutoPaused && (
              <div
                style={{
                  position: 'absolute',
                  top: isSimulating ? 56 : 20,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  background: 'rgba(15, 23, 42, 0.9)',
                  padding: '6px 14px',
                  borderRadius: 20,
                  fontSize: 12,
                  fontWeight: 600,
                  zIndex: 1000,
                  color: '#38bdf8',
                  border: '1px solid rgba(56, 189, 248, 0.4)',
                }}
              >
                Auto-paused (no movement detected)
              </div>
            )}

            {/* Top Back/Invite banner */}
            {isBuddyWalk && buddyUser && (
              <div
                style={{
                  position: 'absolute',
                  top: 20,
                  left: 20,
                  background: 'var(--glass-bg)',
                  border: '1px solid var(--glass-border)',
                  padding: '10px 16px',
                  borderRadius: 12,
                  zIndex: 1000,
                  fontSize: 13,
                  fontWeight: 500,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <Users size={16} style={{ color: 'var(--accent-secondary)' }} />
                <span>Walking with <strong style={{ color: 'var(--text-primary)' }}>{buddyUser.username}</strong></span>
              </div>
            )}
          </div>

          {/* Stats & Controller Dashboard Panel */}
          <div
            className="glass-card"
            style={{
              padding: '24px 32px',
              borderRadius: '24px 24px 0 0',
              borderBottom: 'none',
              display: 'flex',
              flexDirection: 'column',
              gap: 20,
              zIndex: 1000,
            }}
          >
            {/* Live Metrics Grid */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: 16,
                textAlign: 'center',
              }}
            >
              <div>
                <span style={{ color: 'var(--text-secondary)', fontSize: 13, display: 'block', marginBottom: 4 }}>
                  Time
                </span>
                <span style={{ fontSize: 28, fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'monospace' }}>
                  {formatTime(duration)}
                </span>
              </div>
              <div>
                <span style={{ color: 'var(--text-secondary)', fontSize: 13, display: 'block', marginBottom: 4 }}>
                  Distance
                </span>
                <span style={{ fontSize: 28, fontWeight: 800, color: 'var(--accent-primary)', fontFamily: 'monospace' }}>
                  {(distance / 1000).toFixed(2)} <span style={{ fontSize: 14 }}>km</span>
                </span>
              </div>
              <div>
                <span style={{ color: 'var(--text-secondary)', fontSize: 13, display: 'block', marginBottom: 4 }}>
                  Avg Pace
                </span>
                <span style={{ fontSize: 28, fontWeight: 800, color: '#38bdf8', fontFamily: 'monospace' }}>
                  {formatPace()} <span style={{ fontSize: 14 }}>/km</span>
                </span>
              </div>
              <div>
                <span style={{ color: 'var(--text-secondary)', fontSize: 13, display: 'block', marginBottom: 4 }}>
                  Speed
                </span>
                <span style={{ fontSize: 28, fontWeight: 800, color: '#f472b6', fontFamily: 'monospace' }}>
                  {coordinates.length > 0 && coordinates[coordinates.length - 1].speed
                    ? (coordinates[coordinates.length - 1].speed * 3.6).toFixed(1)
                    : (distance > 0 ? ((distance / duration) * 3.6).toFixed(1) : '0.0')}
                  <span style={{ fontSize: 14 }}> km/h</span>
                </span>
              </div>
            </div>

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: 14, justifyContent: 'center', alignItems: 'center' }}>
              <button
                className="btn-secondary"
                onClick={handleToggleSimulation}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  borderColor: isSimulating ? 'var(--accent-primary)' : 'var(--glass-border)',
                  background: isSimulating ? 'rgba(15, 81, 50, 0.1)' : 'var(--glass-bg)',
                }}
              >
                <Sparkles size={16} style={{ color: 'var(--accent-primary)' }} />
                {isSimulating ? 'Stop Simulation' : 'Simulate Walking'}
              </button>

              <button
                onClick={handlePauseToggle}
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: '50%',
                  background: 'var(--bg-card)',
                  border: '1px solid var(--glass-border)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--text-primary)',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--text-primary)')}
                onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--glass-border)')}
              >
                {isPaused ? <Play size={20} fill="currentColor" /> : <Pause size={20} fill="currentColor" />}
              </button>

              <button
                onClick={handleEndWalk}
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: '50%',
                  background: 'var(--danger)',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'white',
                  transition: 'transform 0.2s',
                  boxShadow: '0 0 20px rgba(239, 68, 68, 0.4)',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.08)')}
                onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
              >
                <Square size={20} fill="white" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== CELEBRATION MODAL ===== */}
      {showCelebration && completionSummary && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 110,
            background: 'rgba(0, 0, 0, 0.4)',
            backdropFilter: 'blur(15px)',
            WebkitBackdropFilter: 'blur(15px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          }}
        >
          <div
            className="glass-card fade-in"
            style={{
              width: '100%',
              maxWidth: 500,
              padding: 40,
              textAlign: 'center',
              boxShadow: '0 0 50px rgba(0, 212, 170, 0.15)',
              position: 'relative',
              background: 'var(--bg-secondary)',
            }}
          >
            <button
              onClick={() => setShowCelebration(false)}
              style={{
                position: 'absolute',
                top: 20,
                right: 20,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--text-secondary)',
              }}
            >
              <X size={20} />
            </button>

            <span style={{ fontSize: 64, display: 'block', marginBottom: 16 }}>🎉</span>
            <h2 className="gradient-text" style={{ fontSize: 32, fontWeight: 900, marginBottom: 8 }}>
              Walk Completed!
            </h2>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 28 }}>
              Phenomenal effort! You're building a stronger lifestyle.
            </p>

            {/* Summary Details */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 12,
                background: 'rgba(0, 0, 0, 0.03)',
                padding: 16,
                borderRadius: 12,
                border: '1px solid var(--glass-border)',
                marginBottom: 24,
              }}
            >
              <div>
                <span style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 2 }}>
                  Distance
                </span>
                <strong style={{ fontSize: 16, color: 'var(--text-primary)' }}>
                  {(completionSummary.walk.distance / 1000).toFixed(2)} km
                </strong>
              </div>
              <div>
                <span style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 2 }}>
                  Duration
                </span>
                <strong style={{ fontSize: 16, color: 'var(--text-primary)' }}>
                  {formatTime(completionSummary.walk.duration)}
                </strong>
              </div>
              <div>
                <span style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 2 }}>
                  Avg Pace
                </span>
                <strong style={{ fontSize: 16, color: 'var(--text-primary)' }}>
                  {completionSummary.walk.averagePace > 0
                    ? `${Math.floor(completionSummary.walk.averagePace)}:${Math.round(
                        (completionSummary.walk.averagePace -
                          Math.floor(completionSummary.walk.averagePace)) *
                          60
                      )
                        .toString()
                        .padStart(2, '0')}`
                    : '0:00'}{' '}
                  /km
                </strong>
              </div>
            </div>

            {/* XP and Rewards */}
            <div style={{ marginBottom: 28 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}>
                <span style={{ color: 'var(--text-secondary)' }}>XP Awarded</span>
                <strong style={{ color: 'var(--accent-primary)' }}>+{completionSummary.earnedXp} XP</strong>
              </div>
              {completionSummary.isLevelUp && (
                <div
                  style={{
                    background: 'rgba(251, 191, 36, 0.15)',
                    border: '1px solid rgba(251, 191, 36, 0.3)',
                    color: '#fbbf24',
                    padding: '8px 12px',
                    borderRadius: 8,
                    fontWeight: 700,
                    fontSize: 14,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    marginBottom: 12,
                    animation: 'pulse-glow 1.5s infinite',
                  }}
                >
                  <Trophy size={16} />
                  LEVEL UP! Reached Level {user.level}!
                </div>
              )}
            </div>

            {/* Badges Earned */}
            {completionSummary.newBadges?.length > 0 && (
              <div style={{ marginBottom: 28 }}>
                <h3
                  style={{
                    fontSize: 14,
                    color: 'var(--text-primary)',
                    fontWeight: 600,
                    marginBottom: 12,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                  }}
                >
                  <Award size={16} style={{ color: 'var(--accent-primary)' }} />
                  Achievements Unlocked!
                </h3>
                <div style={{ display: 'flex', justifyContent: 'center', gap: 12 }}>
                  {completionSummary.newBadges.map((badge) => (
                    <div
                      key={badge.name}
                      style={{
                        padding: '10px 14px',
                        background: 'var(--bg-card)',
                        border: '1px solid var(--glass-border)',
                        borderRadius: 12,
                        minWidth: 100,
                      }}
                    >
                      <span style={{ fontSize: 24, display: 'block', marginBottom: 4 }}>{badge.icon}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-primary)', fontWeight: 600 }}>{badge.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <button className="btn-primary" onClick={() => setShowCelebration(false)} style={{ width: '100%' }}>
              Continue
            </button>
          </div>
        </div>
      )}

      {isProfileDialogOpen && (
        <div
          onClick={() => setIsProfileDialogOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 107,
            background: 'rgba(0, 0, 0, 0.5)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="glass-card fade-in"
            style={{ width: '100%', maxWidth: 560, padding: 24, borderRadius: 20 }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <strong style={{ color: 'var(--text-primary)', fontSize: 18 }}>Your Stats</strong>
              <button
                onClick={() => setIsProfileDialogOpen(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                <X size={18} />
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
              {[
                ['Current Streak', `${user?.currentStreak || 0}d`],
                ['Longest Streak', `${user?.longestStreak || 0}d`],
                ['Level', `${user?.level || 1}`],
                ['Total Walks', `${user?.totalWalks || 0}`],
                ['Total Distance', `${((user?.totalDistance || 0) / 1000).toFixed(2)} km`],
                ['Total Steps', `${(user?.totalSteps || 0).toLocaleString()}`],
                ['Longest Walk', `${((user?.longestWalk || 0) / 1000).toFixed(2)} km`],
                ['Longest Run', `${((user?.longestRun || 0) / 1000).toFixed(2)} km`],
                ['XP', `${user?.xp || 0}`],
              ].map(([label, value]) => (
                <div key={label} className="glass-card" style={{ padding: 10, textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{label}</div>
                  <strong style={{ color: 'var(--text-primary)' }}>{value}</strong>
                </div>
              ))}
            </div>

            <button
              onClick={handleLogout}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: 10,
                border: '1px solid rgba(239, 68, 68, 0.35)',
                background: 'rgba(239, 68, 68, 0.12)',
                color: '#f87171',
                cursor: 'pointer',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
              }}
            >
              <LogOut size={16} />
              Logout
            </button>
          </div>
        </div>
      )}

      {selectedWalker && (
        <div
          onClick={() => setSelectedWalker(null)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 105,
            background: 'rgba(0, 0, 0, 0.45)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="glass-card fade-in"
            style={{ width: '100%', maxWidth: 520, padding: 24, borderRadius: 20 }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <div
                style={{
                  width: 54,
                  height: 54,
                  borderRadius: '50%',
                  overflow: 'hidden',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'var(--accent-gradient)',
                  color: 'white',
                  fontWeight: 700,
                }}
              >
                {selectedWalker.profilePhoto ? (
                  <img
                    src={selectedWalker.profilePhoto}
                    alt={selectedWalker.username}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                ) : (
                  selectedWalker.username[0].toUpperCase()
                )}

              </div>
              <div>
                <strong style={{ color: 'var(--text-primary)', fontSize: 18 }}>{selectedWalker.username}</strong>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Level {selectedWalker.level} • {selectedWalker.fitnessLevel || 'walker'}
                </div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
              <div className="glass-card" style={{ padding: 10, textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Streak</div>
                <strong>{selectedWalker.currentStreak || 0}d</strong>
              </div>
              <div className="glass-card" style={{ padding: 10, textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Total Walks</div>
                <strong>{selectedWalker.totalWalks || 0}</strong>
              </div>
              <div className="glass-card" style={{ padding: 10, textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Distance</div>
                <strong>{((selectedWalker.totalDistance || 0) / 1000).toFixed(1)} km</strong>
              </div>
              <div className="glass-card" style={{ padding: 10, textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Steps</div>
                <strong>{(selectedWalker.totalSteps || 0).toLocaleString()}</strong>
              </div>
              <div className="glass-card" style={{ padding: 10, textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Longest Walk</div>
                <strong>{((selectedWalker.longestWalk || 0) / 1000).toFixed(1)} km</strong>
              </div>
              <div className="glass-card" style={{ padding: 10, textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Longest Run</div>
                <strong>{((selectedWalker.longestRun || 0) / 1000).toFixed(1)} km</strong>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => handleFollowToggle(selectedWalker)}
                style={{
                  flex: 1,
                  borderRadius: 10,
                  border: '1px solid var(--glass-border)',
                  background: 'var(--glass-bg)',
                  color: selectedWalker.isFollowing ? 'var(--text-muted)' : 'var(--accent-primary)',
                  padding: '10px 12px',
                  cursor: 'pointer',
                }}
              >
                {selectedWalker.isFollowing ? 'Unfollow' : 'Follow'}
              </button>
              <button
                onClick={() => handleInviteToWalk(selectedWalker._id)}
                className="btn-primary"
                style={{ flex: 1, padding: '10px 12px' }}
              >
                Invite to Walk
              </button>
              <button
                onClick={() => {
                  setSelectedWalker(null);
                  openChatWith(selectedWalker);
                }}
                style={{
                  width: 44,
                  borderRadius: 10,
                  border: '1px solid rgba(56, 189, 248, 0.35)',
                  background: 'rgba(56, 189, 248, 0.15)',
                  color: '#38bdf8',
                  cursor: 'pointer',
                }}
                title="Send message"
              >
                <MessageCircle size={18} />
              </button>
            </div>
          </div>
        </div>
      )}

      {isChatOpen && chatBuddy && (
        <div
          className="glass-card fade-in"
          style={{
            position: 'fixed',
            right: 20,
            bottom: 20,
            zIndex: 106,
            width: 340,
            height: 460,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              padding: '10px 12px',
              borderBottom: '1px solid var(--glass-border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <strong style={{ fontSize: 13, color: 'var(--text-primary)' }}>Chat with {chatBuddy.username}</strong>
            <button
              onClick={() => setIsChatOpen(false)}
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
            >
              <X size={16} />
            </button>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {chatLoading ? (
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading messages...</span>
            ) : (
              chatMessages.map((msg) => {
                const senderId = msg.senderId?._id || msg.senderId || msg.sender?._id;
                const mine = senderId === user?._id;
                return (
                  <div
                    key={msg._id || `${senderId}-${msg.createdAt}`}
                    style={{
                      alignSelf: mine ? 'flex-end' : 'flex-start',
                      maxWidth: '80%',
                      borderRadius: 12,
                      padding: '8px 10px',
                      background: mine ? 'rgba(0, 212, 170, 0.18)' : 'rgba(255, 255, 255, 0.05)',
                      fontSize: 12,
                      color: 'var(--text-primary)',
                    }}
                  >
                    {msg.content}
                  </div>
                );
              })
            )}
            <div ref={chatEndRef} />
          </div>
          <div style={{ display: 'flex', gap: 8, padding: 10, borderTop: '1px solid var(--glass-border)' }}>
            <input
              className="input-field"
              placeholder="Type a message..."
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSendMessage();
              }}
              style={{ flex: 1, fontSize: 12, padding: '8px 10px' }}
            />
            <button
              onClick={handleSendMessage}
              style={{
                width: 36,
                borderRadius: 8,
                border: 'none',
                background: 'var(--accent-gradient)',
                color: 'white',
                cursor: 'pointer',
              }}
            >
              <Send size={14} />
            </button>
          </div>
        </div>
      )}

      {/* ===== MAIN CONTENT ===== */}
      <main
        style={{
          paddingTop: 80,
          paddingLeft: 24,
          paddingRight: 24,
          paddingBottom: 40,
          maxWidth: 1200,
          margin: '0 auto',
        }}
      >
        {/* Stats Cards */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: 16,
            marginBottom: 32,
          }}
        >
          {stats.map((stat, index) => (
            <div
              key={stat.label}
              className="glass-card fade-in"
              style={{
                padding: 24,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                animationDelay: `${index * 0.08}s`,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)', fontSize: 14, fontWeight: 500 }}>
                  {stat.label}
                </span>
                {stat.icon ? (
                  <span style={{ fontSize: 24 }}>{stat.icon}</span>
                ) : (
                  <stat.iconComponent size={22} style={{ color: stat.color }} />
                )}
              </div>
              <span style={{ fontSize: 36, fontWeight: 800, color: stat.color }}>{stat.value}</span>
              {stat.unit && (
                <span style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: -4 }}>{stat.unit}</span>
              )}
              {stat.isLevel && (
                <div>
                  <div
                    style={{
                      height: 6,
                      background: 'var(--glass-border)',
                      borderRadius: 3,
                      overflow: 'hidden',
                      marginTop: 4,
                    }}
                  >
                    <div
                      style={{
                        height: '100%',
                        background: 'linear-gradient(90deg, #fbbf24, #f59e0b)',
                        borderRadius: 3,
                        width: `${Math.min(((user?.xp || 0) % 1000) / 10, 100)}%`,
                        transition: 'width 0.5s ease',
                      }}
                    />
                  </div>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, display: 'block' }}>
                    {user?.xp || 0} XP
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Dashboard Split Screen */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) 360px',
            gap: 24,
            alignItems: 'start',
          }}
        >
          {/* LEFT COLUMN: Map & Quick Start + History */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {/* START WALK BOARD */}
            <div
              className="glass-card"
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 300px',
                minHeight: 300,
                overflow: 'hidden',
              }}
            >
              {/* Map Preview */}
              <div
                style={{
                  position: 'relative',
                  minHeight: 300,
                  background: '#0b1117',
                  borderRight: '1px solid rgba(255,255,255,0.06)',
                }}
              >
                <div
                  ref={mapContainerRef}
                  style={{
                    width: '100%',
                    height: '100%',
                    minHeight: 300,
                    filter: 'contrast(1.08) brightness(1.12) saturate(1.12)',
                  }}
                />
                <button
                  onClick={getCurrentLocation}
                  style={{
                    position: 'absolute',
                    bottom: 16,
                    left: 16,
                    zIndex: 400,
                    width: 36,
                    height: 36,
                    borderRadius: '50%',
                    background: 'var(--glass-bg)',
                    border: '1px solid var(--glass-border)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'white',
                  }}
                >
                  <Compass size={18} />
                </button>
              </div>

              {/* Start panel */}
              <div
                style={{
                  padding: 32,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                  alignItems: 'center',
                  textAlign: 'center',
                  background: 'rgba(0, 0, 0, 0.2)',
                  borderLeft: '1px solid var(--glass-border)',
                }}
              >
                <div
                  style={{
                    position: 'relative',
                    width: 140,
                    height: 140,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      width: '100%',
                      height: '100%',
                      borderRadius: '50%',
                      border: '2px solid transparent',
                      borderTopColor: 'rgba(15, 81, 50, 0.3)',
                      borderRightColor: 'rgba(25, 135, 84, 0.3)',
                      animation: 'spin-slow 6s linear infinite',
                    }}
                  />
                  <button
                    onClick={() => initiateWalk(false, null)}
                    className="btn-primary"
                    style={{
                      width: 110,
                      height: 110,
                      borderRadius: '50%',
                      padding: 0,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 4,
                      fontSize: 16,
                    }}
                  >
                    <span>START</span>
                    <Footprints size={20} />
                  </button>
                </div>
                <p style={{ marginTop: 16, color: 'var(--text-secondary)', fontSize: 13 }}>
                  Tap to start a walk and map your progress!
                </p>
              </div>
            </div>

            {/* WALK HISTORY LIST */}
            <div>
              <h2
                style={{
                  fontSize: 20,
                  fontWeight: 700,
                  marginBottom: 16,
                  color: 'var(--text-primary)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <Activity size={20} style={{ color: 'var(--accent-primary)' }} />
                Recent Walks
              </h2>

              {historyLoading ? (
                <div className="glass-card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
                  Loading history...
                </div>
              ) : walkHistory.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {walkHistory.slice(0, 5).map((walk) => (
                    <div
                      key={walk._id}
                      className="glass-card"
                      style={{
                        padding: '16px 20px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                        <div
                          style={{
                            width: 44,
                            height: 44,
                            borderRadius: 10,
                            background: walk.isBuddyWalk ? 'rgba(25, 135, 84, 0.1)' : 'rgba(15, 81, 50, 0.1)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: walk.isBuddyWalk ? 'var(--accent-secondary)' : 'var(--accent-primary)',
                          }}
                        >
                          <Footprints size={22} />
                        </div>
                        <div>
                          <strong style={{ color: 'var(--text-primary)', fontSize: 15, display: 'block', marginBottom: 2 }}>
                            {(walk.distance / 1000).toFixed(2)} km Walk
                          </strong>
                          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                            {new Date(walk.startTime).toLocaleDateString()} at{' '}
                            {new Date(walk.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            {walk.isBuddyWalk && walk.buddyUserId && ` • with ${walk.buddyUserId.username}`}
                          </span>
                        </div>
                      </div>

                      <div style={{ textAlign: 'right', display: 'flex', gap: 20 }}>
                        <div>
                          <span style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block' }}>Duration</span>
                          <strong style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                            {formatTime(walk.duration)}
                          </strong>
                        </div>
                        <div>
                          <span style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block' }}>Avg Pace</span>
                          <strong style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                            {walk.averagePace > 0
                              ? `${Math.floor(walk.averagePace)}:${Math.round(
                                  (walk.averagePace - Math.floor(walk.averagePace)) * 60
                                )
                                  .toString()
                                  .padStart(2, '0')} /km`
                              : '0:00'}
                          </strong>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="glass-card" style={{ padding: 40, textAlign: 'center' }}>
                  <Footprints
                    size={48}
                    style={{ color: 'var(--text-muted)', margin: '0 auto 16px', opacity: 0.5, display: 'block' }}
                  />
                  <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
                    No walks yet
                  </p>
                  <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                    Hit START to begin your walk session!
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* RIGHT COLUMN: Social Feed & Buddy Invites */}
          <div
            className="glass-card"
            style={{
              padding: 20,
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
              maxHeight: 650,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                padding: 12,
                border: '1px solid var(--glass-border)',
                borderRadius: 12,
                background: 'rgba(255, 255, 255, 0.02)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <Bell size={14} style={{ color: 'var(--accent-primary)' }} />
                <strong style={{ fontSize: 12, color: 'var(--text-primary)' }}>Walk Reminder</strong>
              </div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <input
                  type="time"
                  value={reminderTime}
                  onChange={(e) => setReminderTime(e.target.value)}
                  className="input-field"
                  style={{ flex: 1, fontSize: 12, padding: '8px 10px' }}
                />
                <button
                  onClick={() => setIsReminderEnabled((v) => !v)}
                  style={{
                    padding: '8px 10px',
                    borderRadius: 8,
                    border: '1px solid var(--glass-border)',
                    background: isReminderEnabled ? 'rgba(0, 212, 170, 0.15)' : 'var(--glass-bg)',
                    color: isReminderEnabled ? 'var(--accent-primary)' : 'var(--text-secondary)',
                    fontSize: 11,
                    cursor: 'pointer',
                  }}
                >
                  {isReminderEnabled ? 'On' : 'Off'}
                </button>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="number"
                  min="1"
                  value={quickReminderMinutes}
                  onChange={(e) => setQuickReminderMinutes(Number(e.target.value || 1))}
                  className="input-field"
                  style={{ width: 68, fontSize: 12, padding: '8px 10px' }}
                />
                <button
                  onClick={handleQuickReminder}
                  style={{
                    flex: 1,
                    padding: '8px 10px',
                    borderRadius: 8,
                    border: '1px solid var(--glass-border)',
                    background: 'var(--glass-bg)',
                    color: 'var(--text-secondary)',
                    fontSize: 11,
                    cursor: 'pointer',
                  }}
                >
                  Remind me in minutes
                </button>
              </div>
            </div>

            {/* Tab selector */}
            <div
              style={{
                display: 'flex',
                background: 'rgba(255, 255, 255, 0.03)',
                padding: 4,
                borderRadius: 10,
                border: '1px solid var(--glass-border)',
              }}
            >
              <button
                onClick={() => setActiveTab('nearby')}
                style={{
                  flex: 1,
                  padding: '8px 0',
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 600,
                  border: 'none',
                  cursor: 'pointer',
                  color: activeTab === 'nearby' ? 'white' : 'var(--text-secondary)',
                  background: activeTab === 'nearby' ? 'rgba(255, 255, 255, 0.1)' : 'transparent',
                  transition: 'all 0.2s',
                }}
              >
                Nearby ({nearbyWalkers.length})
              </button>
              <button
                onClick={() => setActiveTab('following')}
                style={{
                  flex: 1,
                  padding: '8px 0',
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 600,
                  border: 'none',
                  cursor: 'pointer',
                  color: activeTab === 'following' ? 'white' : 'var(--text-secondary)',
                  background: activeTab === 'following' ? 'rgba(255, 255, 255, 0.1)' : 'transparent',
                  transition: 'all 0.2s',
                }}
              >
                Following
              </button>
              <button
                onClick={() => setActiveTab('invites')}
                style={{
                  flex: 1,
                  padding: '8px 0',
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 600,
                  border: 'none',
                  cursor: 'pointer',
                  position: 'relative',
                  color: activeTab === 'invites' ? 'white' : 'var(--text-secondary)',
                  background: activeTab === 'invites' ? 'rgba(255, 255, 255, 0.1)' : 'transparent',
                  transition: 'all 0.2s',
                }}
              >
                Invites
                {pendingRequests.incoming.length > 0 && (
                  <span
                    style={{
                      position: 'absolute',
                      top: 4,
                      right: 4,
                      width: 6,
                      height: 6,
                      background: 'var(--accent-primary)',
                      borderRadius: '50%',
                    }}
                  />
                )}
              </button>
            </div>

            {/* List Panel */}
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* TAB 1: NEARBY WALKERS */}
              {activeTab === 'nearby' &&
                (nearbyWalkers.length > 0 ? (
                  nearbyWalkers.map((walker) => (
                    <div
                      key={walker._id}
                      style={{
                        padding: 12,
                        background: 'rgba(255, 255, 255, 0.02)',
                        border: '1px solid var(--glass-border)',
                        borderRadius: 12,
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div
                          style={{
                            width: 32,
                            height: 32,
                            borderRadius: '50%',
                            background: 'var(--accent-gradient)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 12,
                            fontWeight: 700,
                            color: 'white',
                          }}
                        >
                          {walker.username[0].toUpperCase()}
                        </div>
                        <div style={{ cursor: 'pointer' }} onClick={() => setSelectedWalker(walker)}>
                          <strong style={{ fontSize: 13, color: 'white', display: 'block' }}>
                            {walker.username}
                          </strong>
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                            Level {walker.level} • {walker.currentStreak}d streak
                          </span>
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          onClick={() => handleFollowToggle(walker)}
                          style={{
                            padding: '6px 10px',
                            borderRadius: 8,
                            fontSize: 11,
                            border: '1px solid var(--glass-border)',
                            background: 'var(--glass-bg)',
                            color: walker.isFollowing ? 'var(--text-muted)' : 'var(--accent-primary)',
                            cursor: 'pointer',
                          }}
                        >
                          {walker.isFollowing ? 'Unfollow' : 'Follow'}
                        </button>
                        <button
                          onClick={() => handleInviteToWalk(walker._id)}
                          style={{
                            width: 28,
                            height: 28,
                            borderRadius: 8,
                            background: 'var(--accent-gradient)',
                            border: 'none',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: 'white',
                            cursor: 'pointer',
                          }}
                          title="Invite to Buddy Walk"
                        >
                          <Send size={12} />
                        </button>
                        <button
                          onClick={() => openChatWith(walker)}
                          style={{
                            width: 28,
                            height: 28,
                            borderRadius: 8,
                            background: 'rgba(56, 189, 248, 0.15)',
                            border: '1px solid rgba(56, 189, 248, 0.35)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: '#38bdf8',
                            cursor: 'pointer',
                            position: 'relative',
                          }}
                          title="Send Message"
                        >
                          <MessageCircle size={12} />
                          {!!unreadByUser[walker._id] && (
                            <span
                              style={{
                                position: 'absolute',
                                top: -3,
                                right: -3,
                                minWidth: 14,
                                height: 14,
                                padding: '0 3px',
                                borderRadius: 999,
                                background: '#ef4444',
                                color: 'white',
                                fontSize: 9,
                                lineHeight: '14px',
                                textAlign: 'center',
                              }}
                            >
                              {unreadByUser[walker._id]}
                            </span>
                          )}
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 12, padding: '20px 0' }}>
                    No nearby walkers online.
                  </div>
                ))}

              {/* TAB 2: FOLLOWING LIST */}
              {activeTab === 'following' &&
                (followingList.length > 0 ? (
                  followingList.map((walker) => (
                    <div
                      key={walker._id}
                      style={{
                        padding: 12,
                        background: 'rgba(255, 255, 255, 0.02)',
                        border: '1px solid var(--glass-border)',
                        borderRadius: 12,
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div
                          style={{
                            width: 32,
                            height: 32,
                            borderRadius: '50%',
                            background: 'var(--accent-gradient)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 12,
                            fontWeight: 700,
                            color: 'white',
                            opacity: walker.isOnline ? 1 : 0.6,
                          }}
                        >
                          {walker.username[0].toUpperCase()}
                        </div>
                        <div style={{ cursor: 'pointer' }} onClick={() => setSelectedWalker(walker)}>
                          <strong style={{ fontSize: 13, color: 'white', display: 'block' }}>
                            {walker.username}
                          </strong>
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                            {walker.isOnline ? (
                              <span style={{ color: 'var(--accent-primary)' }}>Online • Walking</span>
                            ) : (
                              'Offline'
                            )}
                          </span>
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: 6 }}>
                        {walker.isOnline && (
                          <button
                            onClick={() => handleInviteToWalk(walker._id)}
                            style={{
                              padding: '6px 10px',
                              borderRadius: 8,
                              fontSize: 11,
                              background: 'var(--accent-gradient)',
                              border: 'none',
                              color: 'white',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 4,
                            }}
                          >
                            <Send size={10} /> Invite
                          </button>
                        )}
                        <button
                          onClick={() => openChatWith(walker)}
                          style={{
                            width: 28,
                            height: 28,
                            borderRadius: 8,
                            background: 'rgba(56, 189, 248, 0.15)',
                            border: '1px solid rgba(56, 189, 248, 0.35)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: '#38bdf8',
                            cursor: 'pointer',
                            position: 'relative',
                          }}
                          title="Send Message"
                        >
                          <MessageCircle size={12} />
                          {!!unreadByUser[walker._id] && (
                            <span
                              style={{
                                position: 'absolute',
                                top: -3,
                                right: -3,
                                minWidth: 14,
                                height: 14,
                                padding: '0 3px',
                                borderRadius: 999,
                                background: '#ef4444',
                                color: 'white',
                                fontSize: 9,
                                lineHeight: '14px',
                                textAlign: 'center',
                              }}
                            >
                              {unreadByUser[walker._id]}
                            </span>
                          )}
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 12, padding: '20px 0' }}>
                    You are not following anyone yet.
                  </div>
                ))}

              {/* TAB 3: INCOMING & OUTGOING INVITES */}
              {activeTab === 'invites' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {/* Incoming Section */}
                  <div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: 8 }}>
                      INCOMING INVITES
                    </span>
                    {pendingRequests.incoming.length > 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {pendingRequests.incoming.map((req) => (
                          <div
                            key={req._id}
                            style={{
                              padding: 10,
                              background: 'rgba(0, 212, 170, 0.05)',
                              border: '1px solid rgba(0, 212, 170, 0.2)',
                              borderRadius: 10,
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <div
                                style={{
                                  width: 28,
                                  height: 28,
                                  borderRadius: '50%',
                                  background: 'var(--accent-gradient)',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  fontSize: 11,
                                  color: 'white',
                                }}
                              >
                                {req.senderId.username[0].toUpperCase()}
                              </div>
                              <span style={{ fontSize: 12, color: 'white', fontWeight: 500 }}>
                                {req.senderId.username}
                              </span>
                            </div>
                            <div style={{ display: 'flex', gap: 4 }}>
                              <button
                                onClick={() => handleRespondRequest(req._id, req.senderId._id, 'accepted')}
                                style={{
                                  width: 24,
                                  height: 24,
                                  borderRadius: 6,
                                  background: 'var(--success)',
                                  border: 'none',
                                  color: 'white',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                }}
                              >
                                <Check size={12} />
                              </button>
                              <button
                                onClick={() => handleRespondRequest(req._id, req.senderId._id, 'declined')}
                                style={{
                                  width: 24,
                                  height: 24,
                                  borderRadius: 6,
                                  background: 'var(--danger)',
                                  border: 'none',
                                  color: 'white',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                }}
                              >
                                <X size={12} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', padding: '10px 0' }}>
                        No incoming invites for you.
                      </div>
                    )}
                  </div>

                  {/* Outgoing Section */}
                  <div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: 8 }}>
                      OUTGOING INVITES
                    </span>
                    {pendingRequests.outgoing.length > 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {pendingRequests.outgoing.map((req) => (
                          <div
                            key={req._id}
                            style={{
                              padding: 10,
                              background: 'rgba(255, 255, 255, 0.02)',
                              border: '1px solid var(--glass-border)',
                              borderRadius: 10,
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                            }}
                          >
                            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                              Sent to <strong>{req.receiverId.username}</strong>
                            </span>
                            <span style={{ fontSize: 11, color: 'var(--warning)', fontWeight: 500 }}>
                              Pending
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', padding: '10px 0' }}>
                        No outgoing invites.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
