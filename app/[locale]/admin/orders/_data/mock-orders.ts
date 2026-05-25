export type ReferenceOrderStatus =
  | 'Accepted'
  | 'Pending'
  | 'Completed'
  | 'Rejected'

export interface MockOrderRow {
  id: string
  productName: string
  productCategory: string
  productImage?: string
  customerName: string
  customerType: string
  customerAvatar?: string
  orderId: string
  orderDate: string
  amount: number
  currency: string
  paymentMethod: string
  status: ReferenceOrderStatus
}

export interface MockOrdersKpis {
  totalOrders: number
  newOrders: number
  completedOrders: number
  cancelledOrders: number
}

export const MOCK_ORDERS_KPIS: MockOrdersKpis = {
  totalOrders: 240120,
  newOrders: 8420,
  completedOrders: 198340,
  cancelledOrders: 3260
}

export const MOCK_ORDERS: MockOrderRow[] = [
  {
    id: '1',
    productName: 'Wireless Bluetooth Headphones',
    productCategory: 'Electric Product',
    customerName: 'Sarah Johnson',
    customerType: 'Pro Customer',
    orderId: '#01766703570',
    orderDate: '12 Jan, 2024',
    amount: 10120,
    currency: 'USD',
    paymentMethod: 'Paid by Mastercard',
    status: 'Accepted'
  },
  {
    id: '2',
    productName: 'Smart Watch Series 7',
    productCategory: 'Electric Product',
    customerName: 'Michael Chen',
    customerType: 'New Customer',
    orderId: '#01766703571',
    orderDate: '11 Jan, 2024',
    amount: 4599,
    currency: 'USD',
    paymentMethod: 'Paid by Visa',
    status: 'Pending'
  },
  {
    id: '3',
    productName: 'Ergonomic Office Chair',
    productCategory: 'Furniture',
    customerName: 'Emily Davis',
    customerType: 'Pro Customer',
    orderId: '#01766703572',
    orderDate: '10 Jan, 2024',
    amount: 28900,
    currency: 'USD',
    paymentMethod: 'Cash on Delivery',
    status: 'Completed'
  },
  {
    id: '4',
    productName: '4K Ultra HD Monitor 27"',
    productCategory: 'Electric Product',
    customerName: 'James Wilson',
    customerType: 'New Customer',
    orderId: '#01766703573',
    orderDate: '09 Jan, 2024',
    amount: 67500,
    currency: 'USD',
    paymentMethod: 'Paid by Mastercard',
    status: 'Rejected'
  },
  {
    id: '5',
    productName: 'Mechanical Keyboard RGB',
    productCategory: 'Electric Product',
    customerName: 'Lisa Anderson',
    customerType: 'Pro Customer',
    orderId: '#01766703574',
    orderDate: '08 Jan, 2024',
    amount: 8900,
    currency: 'USD',
    paymentMethod: 'Paid by PayPal',
    status: 'Accepted'
  },
  {
    id: '6',
    productName: 'Standing Desk Pro',
    productCategory: 'Furniture',
    customerName: 'Robert Taylor',
    customerType: 'New Customer',
    orderId: '#01766703575',
    orderDate: '07 Jan, 2024',
    amount: 125000,
    currency: 'USD',
    paymentMethod: 'Paid by Visa',
    status: 'Pending'
  },
  {
    id: '7',
    productName: 'USB-C Hub Adapter',
    productCategory: 'Electric Product',
    customerName: 'Anna Martinez',
    customerType: 'Pro Customer',
    orderId: '#01766703576',
    orderDate: '06 Jan, 2024',
    amount: 3499,
    currency: 'USD',
    paymentMethod: 'Paid by Mastercard',
    status: 'Completed'
  },
  {
    id: '8',
    productName: 'Wireless Mouse Pro',
    productCategory: 'Electric Product',
    customerName: 'David Brown',
    customerType: 'New Customer',
    orderId: '#01766703577',
    orderDate: '05 Jan, 2024',
    amount: 5200,
    currency: 'USD',
    paymentMethod: 'Cash on Delivery',
    status: 'Accepted'
  }
]
