import InteractClient from './InteractClient';

export default async function InteractPage(
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return <InteractClient id={id} />;
}
