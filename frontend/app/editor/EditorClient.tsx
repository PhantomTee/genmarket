'use client';

import dynamic from 'next/dynamic';

const GenLayerEditor = dynamic(
  () => import('../../components/GenLayerEditor'),
  { ssr: false }
);

export default function EditorClient() {
  return <GenLayerEditor />;
}
