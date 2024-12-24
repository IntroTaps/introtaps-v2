function Section4() {

   return (
       <div className="container mt-5 mb-5" style={{backgroundColor: '#c8ce49', padding: '30px ' , borderRadius: '50px'}}>
           <div className="">
               <h1 className="heading-bold-1 text-center">
                  <b>Rethink</b> the way you Network
                   
               </h1>
               <p className="text-muted text-center">Here are some reviews by our customers</p>
               <div className="row">
                   <div className="col-lg-4 mb-2 d-flex justify-content-center">
                       <div className="card-card  shadow-lg">
                           <img src="/img/review1.png " alt="Standard Card" className="imgcardoptions rounded" />
                           <div className="mt-3">
                               <h4><b>Faiqa Amber</b></h4>
                               <span className="text-white">CEO, GlamVegan Beauty</span>
                               <p className='text-white-50'>Made from stainless steel and laser-engraved, this card demands attention. Available in Black, Gold, and Silver. Gold and Silver cards are engraved in black. Black cards will be engraved showing the</p>
                           </div>
                       </div>
                   </div>
                   <div className="col-lg-4 mb-2 d-flex justify-content-center">
                       <div className="card-card  shadow-lg">
                           <img src="/img/customcard.gif" alt="Custom Card" className="imgcardoptions" />
                           <div className="mt-3">
                               <h4><b>Custom</b></h4>
                               <p className='text-white-50'>This eco-friendly approach to networking is sure to make an impression. And we plant a tree for every card sold. Available in Birch (light) and Sapele (dark) from carefully sourced woods.</p>
                           </div>
                       </div>
                   </div>
                   <div className="col-lg-4 mb-2 d-flex justify-content-center">
                       <div className="card-card  shadow-lg">
                           <img src="/standard-card.png" alt="Standard Card" className="imgcardoptions" />
                           <div className="mt-3">
                               <h4><b>Standard</b></h4>
                               <p className='text-white-50'>Made from stainless steel and laser-engraved, this card demands attention. Available in Black, Gold, and Silver. Gold and Silver cards are engraved in black. Black cards will be engraved showing the</p>
                           </div>
                       </div>
                   </div>
               </div>

           </div>
       </div>
   )
}
export default Section4