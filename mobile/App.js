import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import * as Crypto from 'expo-crypto';
import { request, saveSession, clearSession } from './api';
import { startSharing, stopSharing, sharingOrder } from './location';

const SERVICES = [
  { id: 'package', title: 'Package' },
  { id: 'ride', title: 'Ride' },
  { id: 'food', title: 'Food' },
  { id: 'vehicle', title: 'Vehicle' },
  { id: 'business', title: 'Business' },
];

const ROLES = [
  { id: 'customer', title: 'Customer' },
  { id: 'partner', title: 'Delivery Partner' },
  { id: 'business', title: 'Business' },
  { id: 'restaurant', title: 'Restaurant' },
];

const isActive = o => ['assigned', 'arriving', 'picked_up', 'in_transit'].includes(o?.status);
const readable = s => String(s || '').replaceAll('_', ' ');

// ── Reusable UI Components ───────────────────────────────────────────────────

function Button({ title, onPress, disabled, secondary, danger, style }) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        secondary && styles.buttonSecondary,
        danger && styles.buttonDanger,
        disabled && { opacity: 0.5 },
        pressed && { opacity: 0.8 },
        style,
      ]}
    >
      <Text
        style={[
          styles.buttonText,
          secondary && styles.buttonTextSecondary,
          danger && styles.buttonTextDanger,
        ]}
      >
        {title}
      </Text>
    </Pressable>
  );
}

function Field({ title, value, onChangeText, secureTextEntry, multiline, keyboardType, placeholder }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{title}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        secureTextEntry={secureTextEntry}
        multiline={multiline}
        keyboardType={keyboardType}
        placeholder={placeholder}
        placeholderTextColor="#8a998c"
        autoCapitalize={keyboardType === 'email-address' ? 'none' : 'sentences'}
        style={[styles.input, multiline && styles.inputMultiline]}
      />
    </View>
  );
}

// ── Main App Component ───────────────────────────────────────────────────────

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  // Auth state
  const [register, setRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [signupRole, setSignupRole] = useState('customer');

  // Booking & Quote state
  const [service, setService] = useState('package');
  const [pickup, setPickup] = useState('');
  const [destination, setDestination] = useState('');
  const [note, setNote] = useState('');
  const [quote, setQuote] = useState(null);
  const attempt = useRef(null);

  // Delivery code & Rating dialog state
  const [proofOrder, setProofOrder] = useState(null);
  const [proofCode, setProofCode] = useState('');
  const [ratingOrder, setRatingOrder] = useState(null);
  const [ratingValue, setRatingValue] = useState(5);
  const [ratingComment, setRatingComment] = useState('');

  // Lists & active tracking state
  const [orders, setOrders] = useState([]);
  const [offers, setOffers] = useState([]);
  const [shared, setShared] = useState(null);
  const busyLock = useRef(false);

  // ── Data Refresh ───────────────────────────────────────────────────────────

  async function refresh() {
    try {
      const me = await request('/me');
      setUser(me.user);
      const res = await request('/orders');
      setOrders(res.orders || []);
      if (me.user?.role === 'partner') {
        const offRes = await request('/offers');
        setOffers(offRes.orders || []);
      }
      const sharing = await sharingOrder();
      if (sharing && !res.orders?.some(o => o.id === sharing && isActive(o))) {
        await stopSharing();
        setShared(null);
      } else {
        setShared(sharing);
      }
    } catch {
      // Unauthenticated or network issue
    }
  }

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!user) return;
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') {
        refresh().catch(e => setMessage(e.message));
      }
    }, 10000);
    return () => clearInterval(timer);
  }, [user?.id]);

  async function act(work) {
    if (busyLock.current) return;
    busyLock.current = true;
    setBusy(true);
    setMessage('');
    try {
      await work();
      await refresh();
    } catch (e) {
      setMessage(e.message || 'Operation failed.');
    } finally {
      busyLock.current = false;
      setBusy(false);
    }
  }

  // ── Authentication ─────────────────────────────────────────────────────────

  async function authenticate() {
    await act(async () => {
      if (register) {
        await request('/auth/register', { name, email, password, role: signupRole });
      }
      const login = await request('/auth/login', { email, password, native: true });
      await saveSession(login.sessionToken);
      setPassword('');
      setMessage('');
    });
  }

  async function signOut() {
    if (busyLock.current) return;
    busyLock.current = true;
    setBusy(true);
    try {
      await stopSharing();
      await request('/auth/logout', {});
    } catch {
      // Still clear local session on server fail
    } finally {
      await clearSession();
      setUser(null);
      setOrders([]);
      setOffers([]);
      setShared(null);
      setQuote(null);
      busyLock.current = false;
      setBusy(false);
    }
  }

  // ── Quotes & Booking ───────────────────────────────────────────────────────

  async function getQuote() {
    if (!pickup.trim() || !destination.trim()) {
      setMessage('Please enter pickup and destination addresses.');
      return;
    }
    await act(async () => {
      const res = await request('/quotes', { service, pickup, destination });
      setQuote(res.quote);
      setMessage(`Estimate: ${res.quote.priceFormatted} (~${res.quote.distanceKm} km)`);
    });
  }

  async function book() {
    if (!pickup.trim() || !destination.trim()) {
      setMessage('Please provide pickup and destination addresses.');
      return;
    }
    const payload = { service, pickup, destination, note };
    const signature = JSON.stringify(payload);
    const current = attempt.current?.signature === signature
      ? attempt.current
      : { signature, id: Crypto.randomUUID() };
    attempt.current = current;

    await act(async () => {
      const res = await request('/orders', { ...payload, requestId: current.id });
      setPickup('');
      setDestination('');
      setNote('');
      setQuote(null);
      attempt.current = null;
      setMessage(`Request ${res.order.id} submitted!`);
    });
  }

  // ── Partner Hand-off & Proof ───────────────────────────────────────────────

  function locationAction(order) {
    if (shared === order.id) {
      act(async () => {
        await stopSharing();
        setShared(null);
      });
      return;
    }
    const promptText = 'During this active job, your live location is shared with the customer. You can stop sharing at any time.';
    if (Platform.OS === 'web') {
      act(async () => {
        await startSharing(order.id);
        setShared(order.id);
      });
    } else {
      Alert.alert('Share your live location', promptText, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Start sharing',
          onPress: () => act(async () => {
            await startSharing(order.id);
            setShared(order.id);
          }),
        },
      ]);
    }
  }

  async function openNavigation(address) {
    const url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}&travelmode=driving&dir_action=navigate`;
    try {
      await Linking.openURL(url);
    } catch {
      setMessage('Navigation could not open.');
    }
  }

  async function showDeliveryCode(order) {
    await act(async () => {
      const res = await request(`/orders/${encodeURIComponent(order.id)}/delivery-code`, {});
      const msg = `${res.code}\n\nShare this code with your delivery partner only after receiving your package. Valid for 15 minutes.`;
      if (Platform.OS === 'web') {
        alert(`Delivery Code: ${res.code}\n\nShare only after receiving package.`);
      } else {
        Alert.alert('Delivery code', msg);
      }
    });
  }

  async function confirmDelivery() {
    if (!proofOrder || !/^[0-9]{6}$/.test(proofCode)) {
      setMessage('Enter the 6-digit code provided by the customer.');
      return;
    }
    await act(async () => {
      await request(`/orders/${encodeURIComponent(proofOrder)}/status`, {
        status: 'completed',
        proofCode,
      });
      setProofOrder(null);
      setProofCode('');
      setMessage('Delivery completed successfully!');
    });
  }

  // ── Ratings ────────────────────────────────────────────────────────────────

  async function submitRating() {
    if (!ratingOrder) return;
    await act(async () => {
      await request(`/orders/${encodeURIComponent(ratingOrder)}/rating`, {
        rating: ratingValue,
        comment: ratingComment,
      });
      setRatingOrder(null);
      setRatingComment('');
      setMessage('Thank you for rating your delivery!');
    });
  }

  // ── Order Item Component ───────────────────────────────────────────────────

  function OrderCard({ order: o }) {
    const nextStatus = {
      assigned: 'arriving',
      arriving: 'picked_up',
      picked_up: 'in_transit',
      in_transit: 'completed',
    }[o.status];

    const isPartner = user?.role === 'partner';
    const isCustomer = user?.role === 'customer' || user?.role === 'business';
    const isPkg = o.service === 'package';
    const formattedPrice = o.price_paise ? `₹${(o.price_paise / 100).toFixed(2)}` : null;

    return (
      <View style={[styles.card, isActive(o) && styles.cardActive]}>
        <View style={styles.cardHeader}>
          <Text style={styles.badge}>{readable(o.status).toUpperCase()} · {o.service.toUpperCase()}</Text>
          {formattedPrice && <Text style={styles.priceTag}>{formattedPrice}</Text>}
        </View>

        <Text style={styles.small}>{o.id}</Text>
        <Text style={styles.orderAddress}>📍 {o.pickup}</Text>
        <Text style={styles.orderAddress}>🏁 {o.destination}</Text>

        {o.partner && <Text style={styles.body}>Partner: {o.partner.name}</Text>}
        {o.rating && (
          <Text style={styles.ratingText}>
            {'★'.repeat(o.rating.rating)}{'☆'.repeat(5 - o.rating.rating)} {o.rating.comment || ''}
          </Text>
        )}

        {o.location && (
          <View style={styles.locationBox}>
            <Text style={styles.small}>
              Updated {new Date(o.location.updated).toLocaleTimeString()} · ±{Math.round(o.location.accuracy)} m
              {Date.now() - Date.parse(o.location.updated) > 30000 ? ' (stale)' : ''}
            </Text>
            <Button
              secondary
              title="View on Google Maps ↗"
              onPress={() => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${o.location.lat},${o.location.lng}`)}
            />
          </View>
        )}

        {/* Actions for Partner */}
        {isPartner && nextStatus && (
          <View style={styles.actionRow}>
            <Button
              disabled={busy}
              title={`Mark ${readable(nextStatus)} →`}
              onPress={() => {
                if (nextStatus === 'completed' && isPkg) {
                  setProofOrder(o.id);
                  setProofCode('');
                } else {
                  act(() => request(`/orders/${encodeURIComponent(o.id)}/status`, { status: nextStatus }));
                }
              }}
            />
            <Button
              secondary
              title="Navigate ↗"
              onPress={() => openNavigation(['assigned', 'arriving'].includes(o.status) ? o.pickup : o.destination)}
            />
            <Button
              secondary
              danger={shared === o.id}
              disabled={busy}
              title={shared === o.id ? 'Stop location sharing' : 'Share location'}
              onPress={() => locationAction(o)}
            />
          </View>
        )}

        {/* Actions for Customer */}
        {isCustomer && (
          <View style={styles.actionRow}>
            {isPkg && o.status === 'in_transit' && (
              <Button
                secondary
                disabled={busy}
                title="Show delivery code"
                onPress={() => showDeliveryCode(o)}
              />
            )}
            {o.status === 'requested' && (
              <Button
                danger
                secondary
                disabled={busy}
                title="Cancel request"
                onPress={() => act(() => request(`/orders/${encodeURIComponent(o.id)}/status`, { status: 'cancelled' }))}
              />
            )}
            {o.status === 'completed' && !o.rating && (
              <Button
                secondary
                title="Rate order ★"
                onPress={() => {
                  setRatingOrder(o.id);
                  setRatingValue(5);
                  setRatingComment('');
                }}
              />
            )}
          </View>
        )}
      </View>
    );
  }

  // ── Render Screen ──────────────────────────────────────────────────────────

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.screen}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            {/* Header */}
            <View style={styles.header}>
              <View>
                <Text style={styles.logo}>g↗ goserve<Text style={styles.logoDot}>.</Text></Text>
                <Text style={styles.small}>UNIVERSAL MOBILITY & DELIVERY</Text>
              </View>
              {user && (
                <Button secondary title="Sign out" disabled={busy} onPress={signOut} style={styles.signOutBtn} />
              )}
            </View>

            {/* Loading state */}
            {loading ? (
              <ActivityIndicator color="#172821" size="large" style={{ marginTop: 40 }} />
            ) : !user ? (
              /* Signed-out state */
              <>
                <Text style={styles.heading}>Your city.{'\n'}Your next move.</Text>
                <Text style={styles.body}>One account for packages, rides, food, and shipments.</Text>

                <View style={styles.card}>
                  <Text style={styles.title}>{register ? 'Create your account' : 'Welcome back'}</Text>
                  {register && (
                    <>
                      <Field title="Full name" value={name} onChangeText={setName} placeholder="Your name" />
                      <View style={styles.field}>
                        <Text style={styles.label}>Account type</Text>
                        <View style={styles.chips}>
                          {ROLES.map(r => (
                            <Pressable
                              key={r.id}
                              onPress={() => setSignupRole(r.id)}
                              style={[styles.chip, signupRole === r.id && styles.chipActive]}
                            >
                              <Text style={[styles.chipText, signupRole === r.id && styles.chipTextActive]}>
                                {r.title}
                              </Text>
                            </Pressable>
                          ))}
                        </View>
                      </View>
                    </>
                  )}
                  <Field title="Email address" value={email} onChangeText={setEmail} keyboardType="email-address" placeholder="you@example.com" />
                  <Field title="Password (at least 12 characters)" value={password} onChangeText={setPassword} secureTextEntry placeholder="••••••••••••" />

                  <Button title={register ? 'Create account' : 'Sign in'} disabled={busy} onPress={authenticate} />
                  <Button
                    secondary
                    title={register ? 'Already registered? Sign in' : 'Create an account'}
                    onPress={() => setRegister(!register)}
                  />
                </View>
              </>
            ) : (
              /* Signed-in Workspace */
              <>
                <View style={styles.userBanner}>
                  <Text style={styles.heading}>Hello, {user.name.split(' ')[0]}.</Text>
                  <Text style={styles.roleBadge}>{user.role.toUpperCase()}</Text>
                </View>

                {/* Booking Section for Customer/Business */}
                {['customer', 'business'].includes(user.role) && (
                  <View style={styles.card}>
                    <Text style={styles.title}>Book a move</Text>
                    <View style={styles.chips}>
                      {SERVICES.map(s => (
                        <Pressable
                          key={s.id}
                          onPress={() => { setService(s.id); setQuote(null); }}
                          style={[styles.chip, service === s.id && styles.chipActive]}
                        >
                          <Text style={[styles.chipText, service === s.id && styles.chipTextActive]}>
                            {s.title}
                          </Text>
                        </Pressable>
                      ))}
                    </View>

                    <Field title="Pickup address" value={pickup} onChangeText={t => { setPickup(t); setQuote(null); }} multiline placeholder="Enter complete pickup address" />
                    <Field title="Destination address" value={destination} onChangeText={t => { setDestination(t); setQuote(null); }} multiline placeholder="Enter destination address" />
                    <Field title="Instructions (optional)" value={note} onChangeText={setNote} multiline placeholder="Gate code, landmark, parcel notes" />

                    {quote && (
                      <View style={styles.quoteBox}>
                        <Text style={styles.quotePrice}>{quote.priceFormatted}</Text>
                        <Text style={styles.quoteDetails}>Estimated distance: ~{quote.distanceKm} km · {quote.note}</Text>
                      </View>
                    )}

                    <View style={styles.actionRow}>
                      {!quote ? (
                        <Button secondary title="Get estimate" disabled={busy} onPress={getQuote} />
                      ) : (
                        <Button title="Confirm & Book ↗" disabled={busy} onPress={book} />
                      )}
                    </View>
                  </View>
                )}

                {/* Pending approval notice for Partners */}
                {user.role === 'partner' && !user.approved && (
                  <View style={[styles.card, { backgroundColor: '#fff9e6', borderColor: '#f0d060' }]}>
                    <Text style={[styles.title, { color: '#8a6500' }]}>Account Review Pending</Text>
                    <Text style={styles.body}>Operations is reviewing your partner registration. Available jobs will appear here once approved.</Text>
                  </View>
                )}

                {/* Partner: Delivery Code verification modal */}
                {proofOrder && (
                  <View style={[styles.card, styles.cardAccent]}>
                    <Text style={styles.title}>Complete Hand-off</Text>
                    <Text style={styles.body}>Enter the customer's 6-digit delivery code:</Text>
                    <Field title="Delivery code" value={proofCode} onChangeText={setProofCode} keyboardType="number-pad" placeholder="000000" />
                    <View style={styles.actionRow}>
                      <Button title="Verify & Complete" disabled={busy} onPress={confirmDelivery} />
                      <Button secondary title="Cancel" onPress={() => { setProofOrder(null); setProofCode(''); }} />
                    </View>
                  </View>
                )}

                {/* Customer: Rating modal */}
                {ratingOrder && (
                  <View style={[styles.card, styles.cardAccent]}>
                    <Text style={styles.title}>Rate your experience</Text>
                    <View style={styles.chips}>
                      {[1, 2, 3, 4, 5].map(stars => (
                        <Pressable
                          key={stars}
                          onPress={() => setRatingValue(stars)}
                          style={[styles.chip, ratingValue === stars && styles.chipActive]}
                        >
                          <Text style={[styles.chipText, ratingValue === stars && styles.chipTextActive]}>
                            {'★'.repeat(stars)}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                    <Field title="Comments (optional)" value={ratingComment} onChangeText={setRatingComment} multiline placeholder="Driver service, handling, punctuality" />
                    <View style={styles.actionRow}>
                      <Button title="Submit rating" disabled={busy} onPress={submitRating} />
                      <Button secondary title="Cancel" onPress={() => setRatingOrder(null)} />
                    </View>
                  </View>
                )}

                {/* Available Offers for Approved Partners */}
                {user.role === 'partner' && user.approved && (
                  <>
                    <Text style={styles.sectionTitle}>Available Jobs</Text>
                    {offers.length ? (
                      offers.map(o => (
                        <View key={o.id} style={styles.card}>
                          <View style={styles.cardHeader}>
                            <Text style={styles.badge}>{o.service.toUpperCase()}</Text>
                            {o.price_paise && <Text style={styles.priceTag}>₹{(o.price_paise / 100).toFixed(2)}</Text>}
                          </View>
                          <Text style={styles.orderAddress}>📍 {o.pickup}</Text>
                          <Text style={styles.orderAddress}>🏁 {o.destination}</Text>
                          <Button title="Accept job →" disabled={busy} onPress={() => act(() => request(`/orders/${encodeURIComponent(o.id)}/accept`, {}))} />
                        </View>
                      ))
                    ) : (
                      <Text style={styles.body}>No new jobs right now. Fresh requests will appear automatically.</Text>
                    )}
                  </>
                )}

                {/* Activity List */}
                <Text style={styles.sectionTitle}>Your Activity</Text>
                {orders.length ? (
                  orders.map(o => <OrderCard key={o.id} order={o} />)
                ) : (
                  <Text style={styles.body}>No active requests yet. Book a move above to get started.</Text>
                )}

                <Button secondary title="Refresh activity" disabled={busy} onPress={() => act(async () => {})} />
              </>
            )}

            {/* Global notification message */}
            {message ? (
              <View style={styles.messageBox}>
                <Text style={styles.message}>{message}</Text>
              </View>
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f6f7f3' },
  content: { padding: 20, gap: 16, paddingBottom: 60 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#e3e8de',
  },
  logo: { fontSize: 24, fontWeight: '800', color: '#13231a', letterSpacing: -0.5 },
  logoDot: { color: '#88db12' },
  signOutBtn: { paddingVertical: 8, paddingHorizontal: 14 },
  userBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heading: { fontSize: 32, lineHeight: 38, fontWeight: '800', letterSpacing: -1, color: '#13231a' },
  sectionTitle: { fontSize: 20, fontWeight: '700', color: '#13231a', marginTop: 10 },
  title: { fontSize: 18, fontWeight: '700', color: '#13231a', marginBottom: 2 },
  body: { fontSize: 14, lineHeight: 22, color: '#576759' },
  small: { fontSize: 11, color: '#748375' },
  priceTag: { fontSize: 16, fontWeight: '800', color: '#27681c' },
  ratingText: { fontSize: 14, color: '#e69500', fontWeight: '700', marginVertical: 4 },
  card: {
    backgroundColor: '#ffffff',
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e1e7dc',
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  cardActive: { borderColor: '#88db12', borderWidth: 1.5 },
  cardAccent: { backgroundColor: '#f2fae6', borderColor: '#b5e868' },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  badge: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, color: '#4f7528' },
  roleBadge: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    backgroundColor: '#e7f0dc',
    color: '#345517',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  field: { gap: 6 },
  label: { fontSize: 12, fontWeight: '700', color: '#223829' },
  input: {
    borderWidth: 1,
    borderColor: '#d2dcce',
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#fafcfa',
    fontSize: 14,
    color: '#13231a',
  },
  inputMultiline: { minHeight: 65, textAlignVertical: 'top' },
  button: {
    backgroundColor: '#13231a',
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonSecondary: { backgroundColor: '#e8efe2' },
  buttonDanger: { backgroundColor: '#fae8e8', borderColor: '#e69e9e', borderWidth: 1 },
  buttonText: { color: '#c4f03a', fontWeight: '700', fontSize: 13 },
  buttonTextSecondary: { color: '#1a3324' },
  buttonTextDanger: { color: '#a62424' },
  actionRow: { gap: 8, marginTop: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: '#edf2e8',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#d8e2d2',
  },
  chipActive: { backgroundColor: '#cff054', borderColor: '#a7d413' },
  chipText: { fontSize: 13, color: '#2b3f30', fontWeight: '600' },
  chipTextActive: { color: '#0f2014', fontWeight: '700' },
  orderAddress: { fontSize: 14, fontWeight: '600', color: '#193021' },
  locationBox: {
    backgroundColor: '#f3f7ef',
    padding: 12,
    borderRadius: 10,
    gap: 8,
    borderWidth: 1,
    borderColor: '#dce6d7',
  },
  quoteBox: {
    backgroundColor: '#edf6df',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#badfa2',
    alignItems: 'center',
    gap: 4,
  },
  quotePrice: { fontSize: 26, fontWeight: '800', color: '#1c4912' },
  quoteDetails: { fontSize: 12, color: '#38572d' },
  messageBox: {
    backgroundColor: '#fbe8e8',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#f2c2c2',
    marginTop: 8,
  },
  message: { fontSize: 13, lineHeight: 20, color: '#8c2424', textAlign: 'center', fontWeight: '600' },
});
