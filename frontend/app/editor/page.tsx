import dynamic from 'next/dynamic';

// Monaco can't run SSR — must be client-only
const GenLayerEditor = dynamic(() => import('../../components/GenLayerEditor'), { ssr: false });

export default function EditorPage() {
  return <GenLayerEditor />;
}
