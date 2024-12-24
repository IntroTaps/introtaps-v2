function TypeComponent({ title, description, image }) {
   return (
       <div className="col-lg-3 ">
           <div className="card cardhover overflow-hidden mt-5 shadow-lg" style={{  height: '520px', borderRadius: '40px' }}>
               <img src={image} alt="phone" style={{borderRadius: '20px'}} />
               <div  style={{ padding: '20px', textAlign: 'center' }}>
                   <h3><b>{title}</b></h3>
                   <p className="text-muted">{description}
                       
                   </p>
               </div>
              
           </div>
       </div>
   );
}
export default TypeComponent;

