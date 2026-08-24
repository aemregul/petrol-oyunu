import React from 'react';
import { useGameStore } from '../store/gameStore';
import { CustomerFuelModal } from './modals/CustomerFuelModal';
import { FuelOrderModal } from './modals/FuelOrderModal';
import { BuildModal } from './modals/BuildModal';
import { PricingModal } from './modals/PricingModal';
import { StaffModal } from './modals/StaffModal';
import { BankModal } from './modals/BankModal';
import { DayReportModal } from './modals/DayReportModal';
import { OfficeModal } from './modals/OfficeModal';
import { SettingsModal } from './modals/SettingsModal';
import { MissionsModal } from './modals/MissionsModal';

export const ModalContainer: React.FC = () => {
  const activeModal = useGameStore((s) => s.activeModal);

  switch (activeModal) {
    case 'CUSTOMER_FUEL':
      return <CustomerFuelModal />;
    case 'FUEL_ORDER':
      return <FuelOrderModal />;
    case 'BUILD':
      return <BuildModal />;
    case 'PRICING':
      return <PricingModal />;
    case 'STAFF':
      return <StaffModal />;
    case 'BANK':
      return <BankModal />;
    case 'DAY_REPORT':
      return <DayReportModal />;
    case 'OFFICE':
      return <OfficeModal />;
    case 'SETTINGS':
      return <SettingsModal />;
    case 'MISSIONS':
      return <MissionsModal />;
    default:
      return null;
  }
};
