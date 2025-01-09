import { StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import 'bootstrap-icons/font/bootstrap-icons.css'
import 'bootstrap/dist/css/bootstrap.min.css'
import 'bootstrap/dist/js/bootstrap.min.js'
import './App.css'
import Home from './routes/Home'
import Shop from './routes/Shop'
import Business from './routes/Business'
import About from './routes/About'
import StandardCard from './routes/Standard'
const router = createBrowserRouter([
  {
    path: "/", 
    element: <Home />,
},
{
  path: "/shop",
  element: <Shop />,
},
{
  path: "/business",
  element: <Business />,
},
{
  path: "/about",
  element: <About />,
},
{
  path: "/shop/standard",
  element: <StandardCard />
}
])
createRoot(document.getElementById('root')).render(  
<StrictMode>
  <Suspense fallback={<div>Loading...</div>}>
  <RouterProvider router={router} >
  </RouterProvider>
  </Suspense> 
  </StrictMode>
)