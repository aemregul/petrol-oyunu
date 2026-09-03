import React from 'react';
import { useGameStore } from '../store/gameStore';
import { CustomerFuelModal } from './modals/CustomerFuelModal';
import { FuelOrderModal } from './modals/FuelOrderModal';
import { BuildModal } from './modals/BuildModal';
import { PricingModal } from './modals/PricingModal';
import { StaffModal } from './modals/StaffModal';
import { BankModal } from './modals/BankModal';
import { OfficeModal } from './modals/OfficeModal';
import { SettingsModal } from './modals/SettingsModal';
import { MissionsModal } from './modals/MissionsModal';
import { NotificationsModal } from './modals/NotificationsModal';
import { AccountModal } from './modals/AccountModal';

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
    case 'OFFICE':
      return <OfficeModal />;
    case 'SETTINGS':
      return <SettingsModal />;
    case 'MISSIONS':
      return <MissionsModal />;
    case 'NOTIFICATIONS':
      return <NotificationsModal />;
    case 'ACCOUNT':
      return <AccountModal />;
    default:
      return null;
  }
};
