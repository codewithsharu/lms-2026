import Card from './Card';

const StatCard = ({ icon: Icon, label, value, iconColorClass = 'bg-primary', className = '' }) => {
  return (
    <Card className={`p-5 ${className}`.trim()}>
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="body-sm">{label}</p>
          <p className="mt-1 text-2xl font-semibold text-gray-900">{value}</p>
        </div>
        <div className={`flex h-10 w-10 items-center justify-center rounded-xl text-white ${iconColorClass}`.trim()}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
    </Card>
  );
};

export default StatCard;
