"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

interface ReportEntry {
  date: string;
  sizeBytes: number;
  rowCount: number;
  modifiedAt: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export default function ReportsPage() {
  const { status } = useSession();
  const router = useRouter();
  const [reports, setReports] = useState<ReportEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
    if (status === "authenticated") fetchReports();
  }, [status, router]);

  async function fetchReports() {
    setError("");
    try {
      const res = await fetch("/api/reports");
      if (res.ok) {
        setReports(await res.json());
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Failed to load reports");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  if (status === "loading" || loading) {
    return <div className="text-gray-500 text-center py-12">Loading...</div>;
  }

  const totalRows = reports.reduce((s, r) => s + r.rowCount, 0);

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Order Reports</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Per-day exports of successful orders. One file is appended to every time
          an order completes.
        </p>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Stats */}
      {reports.length > 0 && (
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="p-4 bg-gray-900 rounded-xl border border-gray-800">
            <p className="text-xs text-gray-500 uppercase tracking-wider">Days</p>
            <p className="text-2xl font-bold mt-1">{reports.length}</p>
          </div>
          <div className="p-4 bg-gray-900 rounded-xl border border-gray-800">
            <p className="text-xs text-gray-500 uppercase tracking-wider">Total Orders</p>
            <p className="text-2xl font-bold mt-1 text-emerald-400">{totalRows}</p>
          </div>
        </div>
      )}

      {/* Search */}
      {reports.length > 0 && (
        <div className="mb-4">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by date (YYYY, YYYY-MM, ...)"
            className="w-full px-4 py-2.5 bg-gray-900 border border-gray-800 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/40 transition-all"
          />
        </div>
      )}

      {reports.length === 0 ? (
        <div className="text-center py-16 bg-gray-900 rounded-xl border border-gray-800">
          <p className="text-gray-500">No order reports yet.</p>
          <p className="text-sm text-gray-600 mt-1">
            Reports are generated automatically after each successful order.
          </p>
        </div>
      ) : (
        <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-800">
                {["Date", "Orders", "Size", "Last Updated", "Action"].map((h) => (
                  <th
                    key={h}
                    className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {reports
                .filter((r) => {
                  const q = search.trim().toLowerCase();
                  if (!q) return true;
                  return r.date.toLowerCase().includes(q);
                })
                .map((r) => (
                  <tr key={r.date} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                    <td className="px-4 py-3 text-sm font-medium font-mono">{r.date}</td>
                    <td className="px-4 py-3 text-sm text-emerald-400 font-medium">
                      {r.rowCount}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-400">{formatBytes(r.sizeBytes)}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">
                      {new Date(r.modifiedAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <a
                        href={`/api/reports/${r.date}`}
                        download={`orders-${r.date}.tsv`}
                        className="inline-block px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-all font-medium"
                      >
                        Download
                      </a>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
