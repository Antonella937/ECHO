import { TopBar, useBack } from '@/components/echo/top-bar';
import { PlanAndQuotaSettings } from '@/components/echo/plan-and-quota-settings';

export default function SubscriptionsPage() {
  const back = useBack();
  return <div><TopBar title="Mi plan y suscripciones" onBack={back} /><main className="px-4 pb-16 pt-2"><PlanAndQuotaSettings /></main></div>;
}
