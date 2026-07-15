import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft,
  User,
  Edit3,
  Save,
  X,
  Flame,
  MapPin,
  Activity,
  Trophy,
  Zap,
  Award,
  Footprints,
  Users,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function Profile() {
  const { user, updateProfile } = useAuth();
  const navigate = useNavigate();

  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editData, setEditData] = useState({
    username: user?.username || '',
    bio: user?.bio || '',
    fitnessLevel: user?.fitnessLevel || 'beginner',
    profilePhoto: user?.profilePhoto || '',
  });

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await updateProfile(editData);
      setIsEditing(false);
    } catch (err) {
      // error handled by context
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setEditData({
      username: user?.username || '',
      bio: user?.bio || '',
      fitnessLevel: user?.fitnessLevel || 'beginner',
      profilePhoto: user?.profilePhoto || '',
    });
    setIsEditing(false);
  };

  const statCards = [
    {
      icon: Flame,
      color: 'var(--accent-primary)',
      value: user?.currentStreak || 0,
      label: 'Day Streak',
    },
    {
      icon: Trophy,
      color: '#fb7185',
      value: user?.longestStreak || 0,
      label: 'Longest Streak',
    },
    {
      icon: MapPin,
      color: '#38bdf8',
      value: ((user?.totalDistance || 0) / 1000).toFixed(2) + ' km',
      label: 'Total Distance',
    },
    {
      icon: Footprints,
      color: '#a78bfa',
      value: (user?.totalSteps || 0).toLocaleString(),
      label: 'Total Steps',
    },
    {
      icon: Users,
      color: '#10b981',
      value: user?.buddyCount || 0,
      label: 'Buddies',
    },
    {
      icon: Footprints,
      color: '#34d399',
      value: ((user?.longestWalk || 0) / 1000).toFixed(2) + ' km',
      label: 'Longest Walk',
    },
    {
      icon: Activity,
      color: '#ec4899',
      value: ((user?.longestRun || 0) / 1000).toFixed(2) + ' km',
      label: 'Longest Run',
    },
    {
      icon: Activity,
      color: '#f472b6',
      value: user?.totalWalks || 0,
      label: 'Total Walks',
    },
    {
      icon: Zap,
      color: '#fbbf24',
      value: user?.xp || 0,
      label: 'Total XP',
    },
    {
      icon: Trophy,
      color: '#fb923c',
      value: user?.level || 1,
      label: 'Current Level',
    },
  ];

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)' }}>
      {/* ===== NAVBAR ===== */}
      <nav
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 50,
          background: 'rgba(255, 255, 255, 0.85)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderBottom: '1px solid var(--glass-border)',
          padding: '12px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Link
          to="/"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            textDecoration: 'none',
          }}
        >
          <Footprints size={28} style={{ color: 'var(--accent-primary)' }} strokeWidth={1.5} />
          <span
            className="gradient-text"
            style={{ fontSize: 22, fontWeight: 800, letterSpacing: -0.5 }}
          >
            WalkStreak
          </span>
        </Link>

        <button
          onClick={() => navigate('/dashboard')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: 'none',
            border: 'none',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            fontSize: 14,
            fontFamily: 'inherit',
            transition: 'color 0.2s ease',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-secondary)')}
        >
          <ArrowLeft size={18} />
          Back to Dashboard
        </button>
      </nav>

      {/* ===== MAIN CONTENT ===== */}
      <main
        style={{
          paddingTop: 80,
          paddingLeft: 24,
          paddingRight: 24,
          paddingBottom: 40,
          maxWidth: 800,
          margin: '0 auto',
        }}
      >
        {/* Profile Header Card */}
        <div
          className="glass-card fade-in"
          style={{ padding: 32, marginBottom: 24, position: 'relative' }}
        >
          {/* Edit Button */}
          {!isEditing && (
            <button
              onClick={() => setIsEditing(true)}
              style={{
                position: 'absolute',
                top: 20,
                right: 20,
                background: 'none',
                border: '1px solid var(--glass-border)',
                borderRadius: 10,
                padding: '8px 16px',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 13,
                fontFamily: 'inherit',
                transition: 'all 0.2s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--glass-border-hover)';
                e.currentTarget.style.color = 'var(--text-primary)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--glass-border)';
                e.currentTarget.style.color = 'var(--text-secondary)';
              }}
            >
              <Edit3 size={14} />
              Edit
            </button>
          )}

          {/* Profile Content */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 16,
            }}
          >
            {/* Avatar */}
            <div style={{ position: 'relative' }}>
              <div
                style={{
                  width: 120,
                  height: 120,
                  borderRadius: '50%',
                  background: 'var(--accent-gradient)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 48,
                  fontWeight: 800,
                  color: 'white',
                  boxShadow: '0 0 40px rgba(0, 212, 170, 0.2)',
                  overflow: 'hidden',
                  border: '3px solid var(--accent-primary)',
                }}
              >
                {editData.profilePhoto || user?.profilePhoto ? (
                  <img
                    src={editData.profilePhoto || user?.profilePhoto}
                    alt="Profile"
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                ) : (
                  (editData.username || user?.username || 'W')[0].toUpperCase()
                )}
              </div>
              {isEditing && (
                <label
                  style={{
                    position: 'absolute',
                    bottom: 0,
                    right: 0,
                    background: 'var(--accent-gradient)',
                    color: 'var(--bg-primary)',
                    borderRadius: '50%',
                    width: 36,
                    height: 36,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    boxShadow: '0 4px 10px rgba(0, 0, 0, 0.3)',
                    border: '2px solid var(--bg-secondary)',
                    transition: 'transform 0.2s ease',
                  }}
                >
                  <Edit3 size={16} />
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const file = e.target.files[0];
                      if (file) {
                        const reader = new FileReader();
                        reader.onloadend = () => {
                          setEditData({ ...editData, profilePhoto: reader.result });
                        };
                        reader.readAsDataURL(file);
                      }
                    }}
                    style={{ display: 'none' }}
                  />
                </label>
              )}
            </div>

            {!isEditing ? (
              <>
                <h2
                  style={{
                    fontSize: 28,
                    fontWeight: 700,
                    color: 'var(--text-primary)',
                  }}
                >
                  {user?.username || 'Walker'}
                </h2>
                <p
                  style={{
                    fontSize: 15,
                    color: 'var(--text-secondary)',
                    textAlign: 'center',
                    maxWidth: 400,
                  }}
                >
                  {user?.bio || 'No bio yet'}
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                  <span
                    style={{
                      display: 'inline-flex',
                      padding: '6px 16px',
                      borderRadius: 20,
                      background: 'rgba(0, 212, 170, 0.15)',
                      color: 'var(--accent-primary)',
                      fontSize: 13,
                      fontWeight: 600,
                      textTransform: 'capitalize',
                    }}
                  >
                    {user?.fitnessLevel || 'beginner'}
                  </span>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    Member since{' '}
                    {user?.createdAt
                      ? new Date(user.createdAt).toLocaleDateString(undefined, {
                          year: 'numeric',
                          month: 'long',
                        })
                      : 'July 2026'}
                  </p>
                </div>
              </>
            ) : (
              <div
                style={{
                  width: '100%',
                  maxWidth: 400,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 14,
                  marginTop: 8,
                }}
              >
                <div>
                  <label
                    style={{
                      fontSize: 13,
                      color: 'var(--text-secondary)',
                      marginBottom: 4,
                      display: 'block',
                    }}
                  >
                    Username
                  </label>
                  <input
                    className="input-field"
                    value={editData.username}
                    onChange={(e) =>
                      setEditData({ ...editData, username: e.target.value })
                    }
                  />
                </div>
                <div>
                  <label
                    style={{
                      fontSize: 13,
                      color: 'var(--text-secondary)',
                      marginBottom: 4,
                      display: 'block',
                    }}
                  >
                    Bio
                  </label>
                  <textarea
                    className="input-field"
                    value={editData.bio}
                    onChange={(e) =>
                      setEditData({ ...editData, bio: e.target.value })
                    }
                    rows={3}
                    style={{ resize: 'vertical', fontFamily: 'inherit' }}
                  />
                </div>
                <div>
                  <label
                    style={{
                      fontSize: 13,
                      color: 'var(--text-secondary)',
                      marginBottom: 4,
                      display: 'block',
                    }}
                  >
                    Fitness Level
                  </label>
                  <select
                    className="input-field"
                    value={editData.fitnessLevel}
                    onChange={(e) =>
                      setEditData({ ...editData, fitnessLevel: e.target.value })
                    }
                  >
                    <option value="beginner">Beginner</option>
                    <option value="intermediate">Intermediate</option>
                    <option value="advanced">Advanced</option>
                    <option value="expert">Expert</option>
                  </select>
                </div>
                <div
                  style={{
                    display: 'flex',
                    gap: 10,
                    justifyContent: 'center',
                    marginTop: 8,
                  }}
                >
                  <button
                    className="btn-primary"
                    onClick={handleSave}
                    disabled={isSaving}
                    style={{
                      padding: '10px 24px',
                      fontSize: 14,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <Save size={16} />
                    {isSaving ? 'Saving...' : 'Save Changes'}
                  </button>
                  <button
                    className="btn-secondary"
                    onClick={handleCancel}
                    style={{
                      padding: '10px 24px',
                      fontSize: 14,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <X size={16} />
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Stats Grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 16,
            marginBottom: 24,
          }}
        >
          {statCards.map((stat, index) => {
            const IconComp = stat.icon;
            return (
              <div
                key={stat.label}
                className="glass-card fade-in"
                style={{
                  padding: 20,
                  textAlign: 'center',
                  animationDelay: `${index * 0.08}s`,
                }}
              >
                <IconComp
                  size={24}
                  style={{
                    color: stat.color,
                    margin: '0 auto 8px',
                    display: 'block',
                  }}
                />
                <div
                  style={{
                    fontSize: 28,
                    fontWeight: 800,
                    color: stat.color,
                  }}
                >
                  {stat.value}
                </div>
                <div
                  style={{
                    fontSize: 13,
                    color: 'var(--text-secondary)',
                    marginTop: 2,
                  }}
                >
                  {stat.label}
                </div>
              </div>
            );
          })}
        </div>

        {/* Badges Section */}
        <div
          className="glass-card fade-in"
          style={{ padding: 28, animationDelay: '0.3s' }}
        >
          <h3
            style={{
              fontSize: 18,
              fontWeight: 700,
              marginBottom: 16,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <Award size={20} style={{ color: 'var(--accent-primary)' }} />
            Badges & Achievements
          </h3>

          {user?.badges?.length > 0 ? (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
                gap: 12,
              }}
            >
              {user.badges.map((badge, i) => (
                <div
                  key={i}
                  style={{
                    textAlign: 'center',
                    padding: 16,
                    borderRadius: 12,
                    background: 'var(--bg-card)',
                    border: '1px solid var(--glass-border)',
                  }}
                >
                  <Award
                    size={32}
                    style={{
                      color: 'var(--accent-primary)',
                      margin: '0 auto 8px',
                      display: 'block',
                    }}
                  />
                  <p
                    style={{
                      fontSize: 13,
                      color: 'var(--text-primary)',
                      fontWeight: 500,
                    }}
                  >
                    {badge.name || badge}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <Award
                size={40}
                style={{
                  color: 'var(--text-muted)',
                  margin: '0 auto 12px',
                  opacity: 0.4,
                  display: 'block',
                }}
              />
              <p
                style={{
                  fontSize: 15,
                  color: 'var(--text-secondary)',
                  fontWeight: 500,
                }}
              >
                No badges yet
              </p>
              <p
                style={{
                  fontSize: 13,
                  color: 'var(--text-muted)',
                  marginTop: 4,
                }}
              >
                Complete walks and build streaks to earn badges!
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
