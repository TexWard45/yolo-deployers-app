"use client";

import { useState, useCallback, useEffect } from "react";
import { Telemetry } from "@shared/telemetry";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  User,
  Phone,
  Mail,
  ShoppingCart,
  CreditCard,
  Star,
  Package,
  CheckCircle2,
  Activity,
  Eye,
} from "lucide-react";

// ---------- fake product catalog ----------
const PRODUCTS = [
  { id: "SKU-001", name: "Wireless Earbuds Pro",   price: 79.99,  img: "🎧" },
  { id: "SKU-002", name: "Smart Watch Ultra",      price: 249.99, img: "⌚" },
  { id: "SKU-003", name: "Portable Charger 20K",   price: 39.99,  img: "🔋" },
  { id: "SKU-004", name: "Noise-Cancel Headphones", price: 199.99, img: "🎵" },
  { id: "SKU-005", name: "USB-C Hub 7-in-1",       price: 54.99,  img: "🔌" },
  { id: "SKU-006", name: "Mechanical Keyboard",     price: 129.99, img: "⌨️" },
];

export default function CustomerDemoPage() {
  // ---- identity state ----
  const [customerId, setCustomerId] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [identified, setIdentified] = useState(false);

  // ---- demo interaction state ----
  const [cart, setCart] = useState<{ id: string; name: string; price: number; qty: number }[]>([]);
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [orderPlaced, setOrderPlaced] = useState(false);
  const [activeTab, setActiveTab] = useState("products");

  // ---- session id for display ----
  const [sessionId, setSessionId] = useState<string | null>(null);
  useEffect(() => {
    setSessionId(Telemetry.getSessionId());
  }, [identified]);

  // ---------- handlers ----------
  const handleIdentify = useCallback(() => {
    if (!customerId && !phone && !email) return;
    Telemetry.setUser({
      id: customerId || undefined,
      phone: phone || undefined,
      email: email || undefined,
      username: fullName || undefined,
      customer_id: customerId || undefined,
    });
    setIdentified(true);
    setSessionId(Telemetry.getSessionId());
  }, [customerId, phone, email, fullName]);

  const addToCart = useCallback((product: (typeof PRODUCTS)[0]) => {
    setCart((prev) => {
      const existing = prev.find((p) => p.id === product.id);
      if (existing) return prev.map((p) => (p.id === product.id ? { ...p, qty: p.qty + 1 } : p));
      return [...prev, { id: product.id, name: product.name, price: product.price, qty: 1 }];
    });
  }, []);

  const removeFromCart = useCallback((productId: string) => {
    setCart((prev) => prev.filter((p) => p.id !== productId));
  }, []);

  const setRating = useCallback((productId: string, rating: number) => {
    setRatings((prev) => ({ ...prev, [productId]: rating }));
  }, []);

  const placeOrder = useCallback(() => {
    setOrderPlaced(true);
    setCart([]);
    setTimeout(() => setOrderPlaced(false), 4000);
  }, []);

  const cartTotal = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  const cartCount = cart.reduce((sum, item) => sum + item.qty, 0);

  // ---------- UI ----------
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50">
      {/* ── Floating session badge ── */}
      <div className="fixed bottom-4 right-4 z-50">
        <Badge
          variant="outline"
          className="bg-slate-900 text-white border-none px-3 py-2 shadow-lg text-[11px] font-mono flex items-center gap-2"
        >
          <Activity className="w-3 h-3 text-green-400 animate-pulse" />
          {sessionId ? `SID: ${sessionId.slice(0, 12)}…` : "Not recording"}
          {identified && (
            <span className="text-green-400 ml-1">• identified</span>
          )}
        </Badge>
      </div>

      <div className="container mx-auto max-w-5xl py-10 px-4 space-y-8">
        {/* ── Header ── */}
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-extrabold tracking-tight bg-gradient-to-r from-blue-600 to-violet-600 bg-clip-text text-transparent">
            Customer Demo App
          </h1>
          <p className="text-muted-foreground max-w-lg mx-auto">
            Simulate a real customer journey. Identify yourself, browse products, add to
            cart, rate items, and place an order — all tracked by the Telemetry SDK.
          </p>
        </div>

        {/* ── Step 1: Identity Card ── */}
        <Card className={`border-2 transition-all ${identified ? "border-green-500/30 bg-green-50/20" : "border-blue-500/20"}`}>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <User className="w-5 h-5 text-blue-500" />
                <CardTitle className="text-lg">Step 1 — Identify Customer</CardTitle>
              </div>
              {identified && (
                <Badge className="bg-green-500 text-white">
                  <CheckCircle2 className="w-3 h-3 mr-1" /> Identified
                </Badge>
              )}
            </div>
            <CardDescription>
              Fill in at least one field and click Identify. This calls{" "}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">Telemetry.setUser()</code> to
              link the session replay to a customer profile.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium flex items-center gap-1">
                  <User className="w-3 h-3" /> Customer ID
                </label>
                <Input
                  placeholder="e.g. CUS-12345"
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium flex items-center gap-1">
                  <Phone className="w-3 h-3" /> Phone
                </label>
                <Input
                  placeholder="e.g. +84 912 345 678"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium flex items-center gap-1">
                  <Mail className="w-3 h-3" /> Email
                </label>
                <Input
                  type="email"
                  placeholder="user@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium flex items-center gap-1">
                  <User className="w-3 h-3" /> Full Name
                </label>
                <Input
                  placeholder="Nguyễn Văn A"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                />
              </div>
            </div>
            <Button
              className="mt-4 w-full sm:w-auto"
              onClick={handleIdentify}
              disabled={!customerId && !phone && !email}
            >
              {identified ? "Update Identity" : "Identify Customer"}
            </Button>
          </CardContent>
        </Card>

        {/* ── Step 2: Browse & Interact ── */}
        <Card className="border-2 border-slate-200">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <ShoppingCart className="w-5 h-5 text-violet-500" />
              <CardTitle className="text-lg">Step 2 — Browse &amp; Interact</CardTitle>
              {cartCount > 0 && (
                <Badge variant="secondary" className="ml-auto">
                  <ShoppingCart className="w-3 h-3 mr-1" /> {cartCount} items · ${cartTotal.toFixed(2)}
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="mb-4">
                <TabsTrigger value="products">
                  <Package className="w-3.5 h-3.5 mr-1.5" /> Products
                </TabsTrigger>
                <TabsTrigger value="cart">
                  <ShoppingCart className="w-3.5 h-3.5 mr-1.5" /> Cart ({cartCount})
                </TabsTrigger>
              </TabsList>

              {/* ── Products grid ── */}
              <TabsContent value="products" className="m-0">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {PRODUCTS.map((product) => (
                    <div
                      key={product.id}
                      className="group relative border rounded-xl p-4 hover:shadow-md transition-all hover:border-blue-300 cursor-pointer bg-white"
                    >
                      <div className="text-4xl mb-3">{product.img}</div>
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="font-semibold text-sm">{product.name}</p>
                          <p className="text-xs text-muted-foreground font-mono">{product.id}</p>
                        </div>
                        <p className="font-bold text-blue-600">${product.price}</p>
                      </div>

                      {/* ── Star rating ── */}
                      <div className="flex items-center gap-0.5 mt-3">
                        {[1, 2, 3, 4, 5].map((star) => (
                          <button
                            key={star}
                            onClick={() => setRating(product.id, star)}
                            className="focus:outline-none"
                          >
                            <Star
                              className={`w-4 h-4 transition-colors ${
                                (ratings[product.id] ?? 0) >= star
                                  ? "fill-amber-400 text-amber-400"
                                  : "text-slate-300 hover:text-amber-300"
                              }`}
                            />
                          </button>
                        ))}
                        {ratings[product.id] && (
                          <span className="text-[10px] text-muted-foreground ml-1">
                            ({ratings[product.id]}/5)
                          </span>
                        )}
                      </div>

                      <div className="flex gap-2 mt-3">
                        <Button
                          size="sm"
                          className="flex-1 text-xs"
                          onClick={() => addToCart(product)}
                        >
                          <ShoppingCart className="w-3 h-3 mr-1" /> Add
                        </Button>
                        <Button size="sm" variant="ghost" className="text-xs">
                          <Eye className="w-3 h-3 mr-1" /> View
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </TabsContent>

              {/* ── Cart view ── */}
              <TabsContent value="cart" className="m-0">
                {cart.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <ShoppingCart className="w-10 h-10 mx-auto mb-3 opacity-30" />
                    <p>Your cart is empty. Browse products and add some items!</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {cart.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border"
                      >
                        <div>
                          <p className="font-medium text-sm">{item.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {item.qty} × ${item.price.toFixed(2)}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <p className="font-bold text-sm">
                            ${(item.price * item.qty).toFixed(2)}
                          </p>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive text-xs h-7"
                            onClick={() => removeFromCart(item.id)}
                          >
                            Remove
                          </Button>
                        </div>
                      </div>
                    ))}

                    <div className="flex items-center justify-between pt-4 border-t">
                      <p className="font-bold text-lg">Total: ${cartTotal.toFixed(2)}</p>
                      <Button
                        size="lg"
                        className="bg-gradient-to-r from-blue-600 to-violet-600 text-white"
                        onClick={placeOrder}
                      >
                        <CreditCard className="w-4 h-4 mr-2" /> Place Order
                      </Button>
                    </div>
                  </div>
                )}

                {orderPlaced && (
                  <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg text-center animate-in fade-in">
                    <CheckCircle2 className="w-8 h-8 text-green-500 mx-auto mb-2" />
                    <p className="font-semibold text-green-700">Order Placed Successfully!</p>
                    <p className="text-xs text-green-600 mt-1">
                      This interaction is now captured in the session replay.
                    </p>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        {/* ── Footer info ── */}
        <div className="text-center text-xs text-muted-foreground space-y-1">
          <p>
            Every click, scroll, tab switch, form input, and page interaction on this page is recorded
            by the <strong>Telemetry SDK</strong> and can be replayed in the{" "}
            <a href="/admin/replays" className="underline text-blue-500 hover:text-blue-700">
              Admin Replay Portal
            </a>.
          </p>
          <p className="font-mono opacity-50">
            Session: {sessionId ?? "initializing…"}
          </p>
        </div>
      </div>
    </div>
  );
}
