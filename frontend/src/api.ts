/**
 * API client for Social Graph backend
 */

import type { GraphData, ApiStats, FrameSummary } from './types';

const API_BASE = '/api';

/**
 * Fetch graph data for visualization
 */
export async function fetchGraphData(timeframeWindow: number = 30): Promise<GraphData | null> {
  try {
    const response = await fetch(`${API_BASE}/graph?timeframe_window=${timeframeWindow}`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Failed to fetch graph data:', error);
    return null;
  }
}

/**
 * Fetch API statistics
 */
export async function fetchStats(): Promise<ApiStats | null> {
  try {
    const response = await fetch(`${API_BASE}/stats`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Failed to fetch stats:', error);
    return null;
  }
}

/**
 * Build a new frame
 */
export async function buildFrame(
  intervalId?: number,
  timeframeDays: number = 30,
  egoId?: string
): Promise<{ frame_id: number } | null> {
  try {
    const params = new URLSearchParams();
    if (intervalId) params.append('interval_id', intervalId.toString());
    params.append('timeframe_days', timeframeDays.toString());
    if (egoId) params.append('ego_id', egoId);

    const response = await fetch(`${API_BASE}/frames/build?${params}`, {
      method: 'POST',
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Failed to build frame:', error);
    return null;
  }
}

/**
 * Fetch list of available frames
 */
export async function fetchFrames(timeframeWindow: number = 30, limit: number = 20) {
  try {
    const response = await fetch(
      `${API_BASE}/frames?timeframe_window=${timeframeWindow}&limit=${limit}`
    );
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return (await response.json()) as FrameSummary[];
  } catch (error) {
    console.error('Failed to fetch frames:', error);
    return [];
  }
}

/**
 * Fetch a frame by interval id
 */
export async function fetchFrame(
  intervalId: number,
  timeframeWindow: number = 30
): Promise<GraphData | null> {
  try {
    const response = await fetch(
      `${API_BASE}/frames/${intervalId}?timeframe_window=${timeframeWindow}`
    );
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Failed to fetch frame:', error);
    return null;
  }
}

/**
 * Fetch timeline frames sorted by interval time for playback
 */
export async function fetchTimelineFrames(
  timeframeWindow: number = 30,
  limit: number = 100
): Promise<FrameSummary[]> {
  try {
    const response = await fetch(
      `${API_BASE}/timeline/frames?timeframe_window=${timeframeWindow}&limit=${limit}`
    );
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Failed to fetch timeline frames:', error);
    return [];
  }
}

/**
 * Fetch interpolated frame between two intervals for smooth transitions
 */
export async function fetchInterpolatedFrame(
  fromIntervalId: number,
  toIntervalId: number,
  progress: number,
  timeframeWindow: number = 30
): Promise<GraphData | null> {
  try {
    const params = new URLSearchParams({
      from_interval_id: fromIntervalId.toString(),
      to_interval_id: toIntervalId.toString(),
      progress: progress.toString(),
      timeframe_window: timeframeWindow.toString(),
    });
    
    const response = await fetch(`${API_BASE}/timeline/interpolate?${params}`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Failed to fetch interpolated frame:', error);
    return null;
  }
}

/**
 * Fetch position history for a specific account
 */
export async function fetchPositionHistory(
  accountId: string,
  limit: number = 50
): Promise<Array<{
  interval_id: number;
  x: number;
  y: number;
  z: number;
  recorded_at: string;
  source: string;
}>> {
  try {
    const response = await fetch(
      `${API_BASE}/positions/history?account_id=${encodeURIComponent(accountId)}&limit=${limit}`
    );
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Failed to fetch position history:', error);
    return [];
  }
}
